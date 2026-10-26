import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Play, Rows3, X } from 'lucide-react';
import type { WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { PhotoMark, Sighting, SightingBatch as Batch } from '../models/sightingInferencemodel';
import { thumbnailUrl } from '../utils/browserInferenceUtil';
import { classColor, modelClasses, sightingClass } from '../utils/sightingInferenceUtil';

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable=true]');
const time = (iso: string, seconds = false) =>
  new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });

interface SightingBatchProps {
  sightings: Sighting[];
  batch: Batch | null;
  index: number;
  count: number;
  /** The next batch's photos, whose thumbnails load while this batch is reviewed. */
  upcoming: WorkshopRunImage[];
  marks: Record<string, PhotoMark>;
  /** Marks photos as a class or none of them; undefined clears their marks. */
  onMark: (ids: string[], mark: PhotoMark | undefined) => void;
  /** Saves the batch: marks as marked, every other undecided photo a Yes as its sighting. */
  onConfirm: () => void;
  onOpen: (sighting: number, photo: number) => void;
  onFeed: () => void;
  onBatch: (index: number) => void;
  /** Shown after the last batch. */
  end: ReactNode;
}

/**
 * A batch of whole videos as rows of photo crops, one row per sighting. Everything not marked is
 * a Yes as labeled, so only the wrong photos need a click: select them, then a class key or N.
 */
export function SightingBatch({
  sightings,
  batch,
  index,
  count,
  upcoming,
  marks,
  onMark,
  onConfirm,
  onOpen,
  onFeed,
  onBatch,
  end,
}: SightingBatchProps) {
  const rows = useMemo(() => batch?.videos.flatMap(v => v.sightings) ?? [], [batch]);
  const cells = useMemo(
    () => rows.flatMap((s, row) => sightings[s].frames.map((frame, photo) => ({ frame, s, row, photo }))),
    [rows, sightings],
  );
  const classes = cells[0] ? modelClasses(cells[0].frame) : [];
  const [selection, setSelection] = useState<string[]>([]),
    [focus, setFocus] = useState(0),
    anchor = useRef(0);
  const body = useRef<HTMLDivElement>(null),
    seen = useRef(new Set<string>()),
    [unseen, setUnseen] = useState(false);
  // A new batch starts over; more photos loading behind this one leave it as it is.
  const identity = batch ? `${sightings[batch.videos[0].sightings[0]]?.id}/${batch.photos}` : '';
  useEffect(() => {
    setSelection([]);
    setFocus(0);
    anchor.current = 0;
    seen.current = new Set();
    setUnseen(false);
    body.current?.scrollTo?.({ top: 0 });
  }, [identity]);
  // The next batch loads behind this one, a moment after this one's own thumbnails have started.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const f of upcoming) new Image().src = thumbnailUrl(f, true, true);
    }, 1000);
    return () => clearTimeout(timer);
  }, [identity]);

  // Enter saves only photos that have been on screen.
  useEffect(() => {
    const root = body.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries =>
        entries.forEach(e => {
          if (e.isIntersecting) seen.current.add((e.target as HTMLElement).dataset.photo!);
        }),
      { root, threshold: 0.6 },
    );
    root.querySelectorAll('[data-photo]').forEach(cell => observer.observe(cell));
    return () => observer.disconnect();
  }, [cells]);
  function confirm() {
    const missed =
      typeof IntersectionObserver === 'undefined' ? undefined : cells.find(c => !seen.current.has(c.frame.id));
    if (missed) {
      setUnseen(true);
      body.current
        ?.querySelector(`[data-photo="${missed.frame.id}"]`)
        ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      return;
    }
    onConfirm();
  }

  const targets = () => (selection.length ? selection : cells[focus] ? [cells[focus].frame.id] : []);
  function mark(value: PhotoMark) {
    const ids = targets();
    onMark(ids, ids.every(id => marks[id] === value) ? undefined : value);
    setSelection([]);
  }
  function move(to: number, extend: boolean) {
    const next = Math.max(0, Math.min(cells.length - 1, to));
    if (extend && cells[next]) setSelection(s => [...new Set([...s, cells[focus].frame.id, cells[next].frame.id])]);
    setFocus(next);
    body.current?.querySelector(`[data-photo="${cells[next]?.frame.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }
  /** The cell at `photo` of the row `step` rows away, or the row's last. */
  const rowStep = (step: number) => {
    const at = cells[focus];
    if (!at) return focus;
    const row = at.row + step,
      first = cells.findIndex(c => c.row === row);
    return first < 0 ? focus : Math.min(first + at.photo, first + sightings[rows[row]].frames.length - 1);
  };
  function pick(e: MouseEvent, at: number) {
    const id = cells[at].frame.id;
    if (e.shiftKey) {
      const [a, b] = [anchor.current, at].sort((x, y) => x - y);
      setSelection(s => [...new Set([...s, ...cells.slice(a, b + 1).map(c => c.frame.id)])]);
    } else {
      setSelection(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
      anchor.current = at;
    }
    setFocus(at);
  }
  const pickRow = (row: number) => {
    const ids = cells.filter(c => c.row === row).map(c => c.frame.id),
      on = ids.every(id => selection.includes(id));
    setSelection(s => (on ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])]));
  };

  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        typing(e.target) ||
        document.querySelector('[role=dialog]')
      )
        return;
      const key = e.key.toLowerCase(),
        at = cells[focus];
      // A held key repeats; never let it save or mark a run of photos.
      if (e.repeat && !key.startsWith('arrow')) return;
      const digit = /^[1-9]$/.test(key) ? classes[+key - 1] : undefined;
      const action = digit
        ? () => mark(digit.name)
        : (
            {
              n: () => mark(null),
              enter: confirm,
              escape: () => setSelection([]),
              g: onFeed,
              ' ': () => {
                if (at) onOpen(at.s, at.photo);
              },
              arrowright: () => move(focus + 1, e.shiftKey),
              arrowleft: () => move(focus - 1, e.shiftKey),
              arrowdown: () => move(rowStep(1), e.shiftKey),
              arrowup: () => move(rowStep(-1), e.shiftKey),
            } as Record<string, () => void>
          )[key];
      if (!action || !batch) return;
      e.preventDefault();
      action();
    }
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });

  const marked = cells.filter(c => c.frame.id in marks);
  const none = marked.filter(c => marks[c.frame.id] === null).length,
    relabeled = marked.length - none;
  const yes = cells.filter(c => !(c.frame.id in marks) && c.frame.review === 'pending').length;
  const summary =
    [yes && `${yes} Yes`, relabeled && `${relabeled} relabeled`, none && `${none} None`].filter(Boolean).join(' · ') ||
    'Nothing to change';
  const chosen = targets().map(id => marks[id]);
  return (
    <section className="wk-batch" aria-label="Batch review">
      <header className="wk-batch-bar">
        <div className="wk-batch-step">
          <button
            type="button"
            className="wk-icon-button"
            aria-label="Previous batch"
            disabled={index === 0}
            onClick={() => onBatch(index - 1)}
          >
            <ChevronLeft />
          </button>
          <div>
            <strong>{batch ? `Batch ${index + 1} of ${count}` : 'All batches'}</strong>
            {batch && (
              <small>
                {time(batch.videos[0].start)}–{time(batch.videos.at(-1)!.start)} · {batch.photos}{' '}
                {batch.photos === 1 ? 'photo' : 'photos'}
              </small>
            )}
          </div>
          <button
            type="button"
            className="wk-icon-button"
            aria-label="Next batch"
            disabled={!batch}
            onClick={() => onBatch(index + 1)}
          >
            <ChevronRight />
          </button>
        </div>
        {batch && (
          <div
            className="wk-class-keys"
            role="group"
            aria-label={selection.length > 1 ? `Mark ${selection.length} photos as` : 'Mark as'}
          >
            {classes.map((c, i) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={chosen.length > 0 && chosen.every(m => m === c.name)}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                style={{ '--box': classColor(c.id) } as CSSProperties}
                onClick={() => mark(c.name)}
              >
                <i />
                {c.name}
                {i < 9 && <kbd aria-hidden="true">{i + 1}</kbd>}
              </button>
            ))}
            <button
              type="button"
              data-kind="none"
              aria-pressed={chosen.length > 0 && chosen.every(m => m === null)}
              aria-keyshortcuts="N"
              onClick={() => mark(null)}
            >
              <X />
              None<kbd aria-hidden="true">N</kbd>
            </button>
          </div>
        )}
        <div className="wk-batch-trail">
          <button
            type="button"
            className="wk-glass wk-glass-button"
            onClick={onFeed}
            title="One sighting at a time (G)"
            aria-label="Show one sighting at a time"
          >
            <Rows3 />
            <span>Feed</span>
          </button>
          {batch && (
            <button type="button" className="wk-batch-confirm" aria-keyshortcuts="Enter" onClick={confirm}>
              <Check />
              <span>Confirm batch</span>
              <small>{summary}</small>
              <kbd aria-hidden="true">⏎</kbd>
            </button>
          )}
        </div>
      </header>
      {unseen && (
        <p className="wk-batch-hint" role="status">
          Scroll through the whole batch, then press ⏎ again.
        </p>
      )}
      {!batch ? (
        <div className="wk-batch-end">{end}</div>
      ) : (
        <div className="wk-batch-body" ref={body}>
          {batch.videos.map(video => (
            <section
              key={video.start + video.sightings[0]}
              className="wk-batch-video"
              aria-label={`Video at ${time(video.start)}`}
            >
              <h3>
                <button
                  type="button"
                  onClick={() => onOpen(video.sightings[0], -1)}
                  aria-label={`Play the video at ${time(video.start)}`}
                >
                  <Play />
                  {time(video.start)}
                </button>
              </h3>
              {video.sightings.map(s => {
                const sighting = sightings[s],
                  row = rows.indexOf(s),
                  label = sightingClass(sighting);
                return (
                  <div key={sighting.id} className="wk-batch-row">
                    <button
                      type="button"
                      className="wk-batch-label"
                      onClick={() => pickRow(row)}
                      aria-label={`Select all ${sighting.frames.length} photos of this ${label} sighting`}
                    >
                      <strong>{label}</strong>
                      <small>{time(sighting.frames[0].captured_at, true)}</small>
                    </button>
                    <div className="wk-batch-cells">
                      {sighting.frames.map((frame, photo) => {
                        const at = cells.findIndex(c => c.frame.id === frame.id),
                          value = marks[frame.id],
                          shown = value === undefined ? label : (value ?? 'None');
                        return (
                          <button
                            key={frame.id}
                            type="button"
                            className="wk-batch-cell"
                            data-photo={frame.id}
                            data-focus={at === focus || undefined}
                            data-review={frame.review}
                            data-mark={value === undefined ? undefined : value === null ? 'none' : 'class'}
                            aria-pressed={selection.includes(frame.id)}
                            aria-label={`${shown}, photo ${photo + 1} of ${sighting.frames.length}, ${time(frame.captured_at, true)}${frame.review === 'accepted' ? ', Yes' : frame.review === 'rejected' ? ', No' : ''}`}
                            onClick={e => pick(e, at)}
                            onDoubleClick={() => onOpen(s, photo)}
                          >
                            <img
                              src={thumbnailUrl(frame, true, true)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                            />
                            {value !== undefined && (
                              <span
                                className="wk-batch-mark"
                                style={
                                  value === null
                                    ? undefined
                                    : ({
                                        '--box': classColor(classes.find(c => c.name === value)?.id ?? 0),
                                      } as CSSProperties)
                                }
                              >
                                {value ?? 'None'}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
