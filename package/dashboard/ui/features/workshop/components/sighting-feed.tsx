import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { keepClips } from '../../../lib/clip-cache';
import type { WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { ReviewChange, ReviewDecision, ReviewerPreferences } from '../models/reviewInferencemodel';
import type { PhotoMark, Sighting, SightingClip as Clip } from '../models/sightingInferencemodel';
import type { useReviewDecisions } from '../hooks/use-review-decisions';
import { readReviewerPreferences, writeReviewerPreferences } from '../db/ReviewerInferenceOps';
import { usePhoneReviewer } from '../hooks/use-phone-reviewer';
import { useSnapScroll } from '../hooks/use-snap-scroll';
import {
  batchSightings,
  markedChanges,
  modelClasses,
  sightingClass,
  sightingState,
  surestPhoto,
  undoChanges,
} from '../utils/sightingInferenceUtil';
import { AnnotationEditor } from './annotation-editor';
import { SightingBatch } from './sighting-batch';
import { SightingCard } from './sighting-card';
import { clipKey } from './sighting-clip';

// ponytail: 4× of the camera's 30 fps 4K is 120 decoded frames a second, inside the ~150 the recording
// player measured; faster needs its keyframe stepping.
const SPEEDS = [1, 2, 4];

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable=true]');
// Enter and Space on a focused button or link press it, never the reviewer's shortcut for the sighting.
const pressing = (e: KeyboardEvent) =>
  (e.key === 'Enter' || e.key === ' ') &&
  e.target instanceof HTMLElement &&
  !!e.target.closest('button, a[href], [role=button]');
const without = (marks: Record<string, PhotoMark>, frames: WorkshopRunImage[]) => {
  const next = { ...marks };
  for (const f of frames) delete next[f.id];
  return next;
};

interface SightingFeedProps {
  /** In feed order, carrying the latest reviews and labels. */
  sightings: Sighting[];
  clips: Map<string, Clip | null>;
  decisions: ReturnType<typeof useReviewDecisions>;
  start?: number;
  bucket: (sighting: Sighting) => string;
  /** More buttons for a sighting's actions, given the photo on screen. */
  actions?: (sighting: Sighting, frame: WorkshopRunImage) => ReactNode;
  /** The screen after the last sighting. */
  end: ReactNode;
  onFocus: (itemId: string, index: number) => void;
  onEditState?: (dirty: boolean, busy: boolean) => void;
}

/**
 * Sightings one per screen: swipe up (or ↓) for the next, sideways (← →) through its video and
 * photos. 1–9 says what the object is, Enter confirms all of its photos and goes on, N says it is
 * none of them. G shows the sighting's batch as a grid. E opens the label editor.
 */
export function SightingFeed({
  sightings,
  clips,
  decisions,
  start = 0,
  bucket,
  actions,
  end,
  onFocus,
  onEditState,
}: SightingFeedProps) {
  const [preferences, setPreferences] = useState(readReviewerPreferences);
  const prefer = (change: Partial<ReviewerPreferences>) =>
    setPreferences(p => {
      const next = { ...p, ...change };
      writeReviewerPreferences(next);
      return next;
    });
  /** The page a sighting opens on: its video, or its surest photo. */
  const opening = (index: number) => {
    const s = sightings[index];
    return s && preferences.open === 'photo' ? (clips.get(s.id) ? 1 : 0) + surestPhoto(s.frames) : 0;
  };
  const [current, setCurrent] = useState(start),
    [page, setPage] = useState(() => opening(start)),
    [zoomed, setZoomed] = useState(true);
  const [editing, setEditing] = useState<number | null>(null),
    [dirty, setDirty] = useState(false);
  // What the reviewer says photos show, saved by Enter: a class name, or null for none of them.
  const [marks, setMarks] = useState<Record<string, PhotoMark>>({});
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null),
    [expanded, setExpanded] = useState(false);
  // On a phone a decision shows as a stamp where you acted, and Undo waits small in the bottom corner.
  const phone = usePhoneReviewer(),
    [stamp, setStamp] = useState<{ id: number; choice: 'accepted' | 'rejected' } | null>(null);
  const [, setClipsReady] = useState(0),
    [speed, setSpeed] = useState(1);
  const player = useRef<HTMLVideoElement>(null);
  const [feed, onScroll] = useSnapScroll('y', current, index => {
    setCurrent(index);
    setPage(opening(index));
  });
  const sighting = sightings[current] ?? null,
    lead = sighting && clips.get(sighting.id) ? 1 : 0,
    grid = preferences.view === 'grid';
  const batches = useMemo(() => batchSightings(sightings), [sightings.map(s => `${s.id}/${s.frames.length}`).join()]);
  const batch =
    current >= sightings.length
      ? batches.length
      : Math.max(
          0,
          batches.findIndex(b => b.videos.some(v => v.sightings.includes(current))),
        );

  // Undo runs later from a toast, so it reads the current card through a ref, not a stale render.
  const shown = useRef(current);
  shown.current = current;
  const go = (index: number, at?: number) => {
    const next = Math.max(0, Math.min(sightings.length, index));
    if (next !== shown.current) {
      shown.current = next;
      setCurrent(next);
      setPage(at ?? opening(next));
    } else if (at !== undefined) setPage(at);
  };
  const turn = (step: number) => {
    if (sighting) setPage(p => Math.max(0, Math.min(sighting.frames.length + lead - 1, p + step)));
  };
  const edit = (at = current) => {
    if (sightings[at]) {
      player.current?.pause();
      setEditing(at === current ? Math.max(0, page - lead) : 0);
      go(at);
    }
  };
  const togglePlay = () => {
    const video = player.current;
    if (video) void (video.paused ? video.play().catch(() => {}) : video.pause());
  };
  /** The class a number key gave the sighting's photos, if they all have one. */
  const staged = (s: Sighting) => {
    const mark = marks[s.frames[0].id];
    return typeof mark === 'string' && s.frames.every(f => marks[f.id] === mark) ? mark : null;
  };
  function choose(name: string) {
    if (!sighting) return;
    setMarks(m =>
      staged(sighting) === name || name === sightingClass(sighting)
        ? without(m, sighting.frames)
        : { ...m, ...Object.fromEntries(sighting.frames.map(f => [f.id, name])) },
    );
  }

  /** Saves photos' reviews with Undo in a toast that names them. */
  async function save(changes: ReviewChange[], text: string, back: () => void) {
    const undo = () => {
      setToast(null);
      back();
      void decisions.apply(undoChanges(changes)).then(r => {
        if (r.failed) setToast({ text: `Couldn’t undo ${r.failed} of ${changes.length} photos. ${r.message}` });
      });
    };
    setToast({ text, undo });
    const result = await decisions.apply(changes);
    if (result.failed)
      setToast({ text: `Couldn’t save ${result.failed} of ${changes.length} photos. ${result.message}` });
  }
  /**
   * Sets every photo in a sighting at once, as marked, then moves on. The lit choice pressed again
   * clears it, unless `keep` (Enter) or a mark asks for it again.
   */
  function decide(choice: Exclude<ReviewDecision, 'pending'>, at = current, linger = 0, keep = false) {
    const target = sightings[at];
    if (!target) return;
    const marked = target.frames.some(f => f.id in marks),
      name = choice === 'accepted' ? (staged(target) ?? sightingClass(target)) : sightingClass(target);
    const clearing = !keep && !(choice === 'accepted' && marked) && sightingState(target) === choice;
    const changes: ReviewChange[] = clearing
      ? target.frames.map(f => [f, 'pending'])
      : choice === 'rejected'
        ? target.frames.map(f => [f, 'rejected'])
        : markedChanges(target, marks, false);
    setMarks(m => without(m, target.frames));
    if (!clearing && !linger && phone) setStamp({ id: performance.now(), choice });
    if (!clearing) {
      if (linger)
        setTimeout(() => {
          if (shown.current === at) go(at + 1);
        }, linger);
      else go(at + 1);
    }
    void save(changes, `${name} · ${clearing ? 'Undecided' : choice === 'accepted' ? 'Confirmed' : 'None'}`, () =>
      go(at),
    );
  }
  /** Saves a batch: marks as marked, other undecided photos a Yes as their sighting; then the next batch. */
  function confirmBatch() {
    const b = batches[batch];
    if (!b) return;
    const members = b.videos.flatMap(v => v.sightings.map(i => sightings[i]));
    const changes = members.flatMap(s => markedChanges(s, marks, true)),
      first = b.videos[0].sightings[0];
    setMarks(m =>
      without(
        m,
        members.flatMap(s => s.frames),
      ),
    );
    go(batches[batch + 1]?.videos[0].sightings[0] ?? sightings.length);
    const no = changes.filter(c => c[1] === 'rejected').length;
    if (changes.length)
      void save(changes, `${changes.length - no} confirmed${no ? ` · ${no} None` : ''}`, () => go(first));
  }

  useEffect(() => {
    if (editing !== null) return;
    function down(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        typing(e.target) ||
        pressing(e) ||
        document.querySelector('[role=dialog]')
      )
        return;
      const key = e.key.toLowerCase();
      if (e.metaKey) {
        if (key === 'z' && toast?.undo) {
          e.preventDefault();
          toast.undo();
        }
        return;
      }
      // The batch grid has keys of its own; a held key repeats, and must never decide a run of sightings.
      if (grid || (e.repeat && !key.startsWith('arrow') && !['j', 'k', 'h', 'l', 'pagedown', 'pageup'].includes(key)))
        return;
      // Past the last sighting, the end card's own buttons take Enter.
      if (!sighting && ['enter', 'y', 'n', 'e'].includes(key)) return;
      const next = () => go(current + 1),
        previous = () => go(current - 1),
        forward = () => turn(1),
        back = () => turn(-1);
      const digit = sighting && /^[1-9]$/.test(key) ? modelClasses(sighting.frames[0])[+key - 1] : undefined;
      const action = digit
        ? () => choose(digit.name)
        : (
            {
              arrowdown: next,
              j: next,
              pagedown: next,
              arrowup: previous,
              k: previous,
              pageup: previous,
              arrowright: forward,
              l: forward,
              arrowleft: back,
              h: back,
              enter: () => decide('accepted', current, 0, true),
              y: () => decide('accepted'),
              n: () => decide('rejected'),
              e: () => edit(),
              z: () => setZoomed(z => !z),
              g: () => prefer({ view: 'grid' }),
              ' ': togglePlay,
            } as Record<string, () => void>
          )[key];
      if (!action) return;
      e.preventDefault();
      action();
    }
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });
  useEffect(() => {
    setExpanded(false);
  }, [toast]);
  // An error being read stays until it is tapped closed.
  useEffect(() => {
    if (!toast || expanded) return;
    const timer = setTimeout(() => setToast(null), phone ? 5000 : 6000);
    return () => clearTimeout(timer);
  }, [toast, expanded]);
  // On a timer, not the animation's end: Reduce Motion turns the animation off.
  useEffect(() => {
    if (!stamp) return;
    const timer = setTimeout(() => setStamp(null), 600);
    return () => clearTimeout(timer);
  }, [stamp]);
  // Unsaved marks count as edits, so leaving asks first.
  const marking = Object.keys(marks).length > 0;
  useEffect(() => {
    onEditState?.(dirty || marking, false);
    return () => onEditState?.(false, false);
  }, [dirty, marking, onEditState]);
  // A clip that arrives after its sighting opened goes in front of the photos; photo first keeps the photo on screen.
  const opened = useRef({ id: '', lead: 0 });
  useEffect(() => {
    const was = opened.current;
    opened.current = { id: sighting?.id ?? '', lead };
    if (was.id === sighting?.id && lead > was.lead && preferences.open === 'photo') setPage(p => p + lead - was.lead);
  }, [sighting?.id, lead]);
  // Originals load into the browser's cache before they are needed: this sighting's first few, then
  // the photo the next two open on, which is also their clip's poster.
  // ponytail: up to six ~0.8 MB originals ahead; trim if review moves to metered connections.
  useEffect(() => {
    if (grid || !sighting) return;
    const ahead = [
      ...sighting.frames.slice(0, 4),
      ...[1, 2].flatMap(step => {
        const s = sightings[current + step];
        return s ? [s.frames[surestPhoto(s.frames)]] : [];
      }),
    ];
    for (const f of ahead) new Image().src = f.image_url;
  }, [sighting?.id, grid]);
  const frame = sighting?.frames[Math.max(0, page - lead)];
  // In the grid, the batch's last sighting is in view, so the feed loads what follows it.
  const reach = grid ? (batches[batch]?.videos.at(-1)?.sightings.at(-1) ?? current) : current;
  useEffect(() => {
    if (frame) onFocus(frame.id, reach);
  }, [frame?.id, reach]);
  // The current sighting's seconds first, then the next two (a few MB each), so a swipe starts playing from memory.
  const upcoming = grid
    ? []
    : [0, 1, 2].flatMap(step => {
        const s = sightings[current + step],
          clip = s && clips.get(s.id);
        return clip ? [clipKey(s, clip)] : [];
      });
  useEffect(() => {
    if (upcoming.length) keepClips(upcoming, 5, () => setClipsReady(n => n + 1), upcoming.slice(0, 1));
  }, [upcoming.join()]);

  return (
    <>
      <div
        className="wk-feed"
        ref={feed}
        onScroll={onScroll}
        role="feed"
        aria-label="Sightings"
        aria-busy={false}
        inert={grid || undefined}
      >
        {sightings.map((s, i) => (
          <div key={s.id} className="wk-feed-item">
            {Math.abs(i - current) <= 1 && (
              <SightingCard
                sighting={s}
                clip={clips.get(s.id) ?? null}
                index={i}
                total={sightings.length}
                bucket={bucket(s)}
                current={i === current && !grid}
                page={page}
                onPage={setPage}
                zoomed={zoomed}
                onZoom={() => setZoomed(z => !z)}
                speed={speed}
                onSpeed={() => setSpeed(v => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])}
                staged={staged(s)}
                classes={modelClasses(s.frames[0])}
                onClass={name => {
                  if (i === current) choose(name);
                }}
                open={preferences.open}
                onOpenOn={() => prefer({ open: preferences.open === 'photo' ? 'video' : 'photo' })}
                onGrid={() => prefer({ view: 'grid' })}
                player={player}
                onDecide={(choice, linger) => decide(choice, i, linger ? 550 : 0)}
                onEdit={() => edit(i)}
                phone={phone}
                lifted={phone && !!toast && i === current}
              >
                {actions?.(s, i === current && frame ? frame : s.frames[0])}
              </SightingCard>
            )}
          </div>
        ))}
        <div className="wk-feed-item">{end}</div>
      </div>
      {grid && (
        <SightingBatch
          sightings={sightings}
          batch={batches[batch] ?? null}
          index={batch}
          count={batches.length}
          marks={marks}
          end={end}
          upcoming={batches[batch + 1]?.videos.flatMap(v => v.sightings.flatMap(i => sightings[i].frames)) ?? []}
          onMark={(ids, mark) =>
            setMarks(m => {
              const next = { ...m };
              for (const id of ids) {
                if (mark === undefined) delete next[id];
                else next[id] = mark;
              }
              return next;
            })
          }
          onConfirm={confirmBatch}
          onFeed={() => prefer({ view: 'feed' })}
          onBatch={n => go(batches[n]?.videos[0].sightings[0] ?? sightings.length)}
          onOpen={(s, photo) => {
            prefer({ view: 'feed' });
            go(s, photo < 0 ? 0 : (clips.get(sightings[s].id) ? 1 : 0) + photo);
          }}
        />
      )}
      {sightings.length > 0 && !grid && (
        <nav className="wk-feed-nav" aria-label="Sighting navigation">
          <button
            type="button"
            className="wk-glass wk-round"
            aria-label="Previous sighting"
            title="Previous (↑)"
            disabled={current === 0}
            onClick={() => go(current - 1)}
          >
            <ChevronUp />
          </button>
          <span>
            {Math.min(current + 1, sightings.length)}
            <small>of {sightings.length}</small>
          </span>
          <button
            type="button"
            className="wk-glass wk-round"
            aria-label="Next sighting"
            title="Next (↓)"
            disabled={current >= sightings.length}
            onClick={() => go(current + 1)}
          >
            <ChevronDown />
          </button>
        </nav>
      )}
      {toast && !phone && (
        <div className="wk-toast wk-glass" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
      {toast && phone && (
        <div className="wk-undo-row" role="status">
          {toast.undo ? (
            <>
              <span className="sr-only">{toast.text}</span>
              <button type="button" className="wk-undo" onClick={toast.undo}>
                <RotateCcw aria-hidden="true" />
                Undo
              </button>
            </>
          ) : (
            <button
              type="button"
              className="wk-undo-error"
              aria-expanded={expanded}
              onClick={() => setExpanded(e => !e)}
            >
              {toast.text}
            </button>
          )}
        </div>
      )}
      {stamp && (
        <span
          key={stamp.id}
          className="wk-stamp"
          data-choice={stamp.choice === 'accepted' ? 'yes' : 'no'}
          aria-hidden="true"
        >
          {stamp.choice === 'accepted' ? <Check /> : <X />}
        </span>
      )}
      {editing !== null && sighting && (
        <AnnotationEditor
          frames={sighting.frames}
          start={editing}
          onSave={decisions.save}
          onDirty={setDirty}
          onClose={() => {
            setEditing(null);
            void player.current?.play().catch(() => {});
          }}
        />
      )}
    </>
  );
}
