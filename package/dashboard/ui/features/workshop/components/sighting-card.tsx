import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useHoldToPeek } from '../hooks/use-hold-to-peek';
import { useSnapScroll } from '../hooks/use-snap-scroll';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  Pencil,
  ScanSearch,
  Video,
  X,
} from 'lucide-react';
import type { Sighting, SightingClip as Clip } from '../models/sightingInferencemodel';
import type { ReviewDecision, ReviewerPreferences, ScreenRect } from '../models/reviewInferencemodel';
import { thumbnailUrl } from '../utils/browserInferenceUtil';
import {
  classColor,
  classInk,
  decidedLabels,
  labelsOf,
  overlapped,
  sightingClass,
  sightingState,
  topLabel,
} from '../utils/sightingInferenceUtil';
import { FrameStage } from './review-stage';
import { SightingClip } from './sighting-clip';

interface SightingCardProps {
  sighting: Sighting;
  clip: Clip | null;
  index: number;
  total: number;
  bucket: string;
  /** Only the current card plays video, loads every page, and reports its page. */
  current: boolean;
  page: number;
  onPage: (page: number) => void;
  zoomed: boolean;
  onZoom: () => void;
  player: RefObject<HTMLVideoElement | null>;
  /** The video's playback rate, which `onSpeed` steps through. */
  speed: number;
  onSpeed: () => void;
  /** The class a number key chose for the object, shown but not saved until a Confirm. */
  staged: string | null;
  classes: { id: number; name: string }[];
  onClass: (name: string) => void;
  /** Whether the next sighting opens on its video or its surest photo. */
  open: ReviewerPreferences['open'];
  onOpenOn: () => void;
  onGrid: () => void;
  /** `linger` holds the card a moment first, so a double-tap's check is seen before it moves on. */
  onDecide: (review: Exclude<ReviewDecision, 'pending'>, linger?: boolean) => void;
  onEdit: () => void;
  /** Laid out for a phone: a two-line caption whose title opens the classes. */
  phone?: boolean;
  /** The caption steps up to make room for Undo in the bottom corner. */
  lifted?: boolean;
  /** More actions, between Edit and the choice. */
  children?: ReactNode;
}

/** One sighting: its video, then each photo a swipe to the side, with what it is and a Confirm or None for all of it. */
export function SightingCard({
  sighting,
  clip,
  index,
  total,
  bucket,
  current,
  page,
  onPage,
  zoomed,
  onZoom,
  player,
  speed,
  onSpeed,
  staged,
  classes,
  onClass,
  open,
  onOpenOn,
  onGrid,
  onDecide,
  onEdit,
  phone = false,
  lifted = false,
  children,
}: SightingCardProps) {
  const lead = clip ? 1 : 0,
    pages = sighting.frames.length + lead,
    shown = current ? page : 0;
  const [pager, onScroll] = useSnapScroll(
      'x',
      shown,
      next => {
        if (current) onPage(next);
      },
      lead,
    ),
    strip = useRef<HTMLDivElement>(null);
  const state = sightingState(sighting),
    best = Math.max(...sighting.frames.map(f => topLabel(f)?.confidence ?? 0));
  const title = staged ?? sightingClass(sighting);
  // A chosen class shows on the photos as it will save: one box on the object, named that class.
  const frames = useMemo(
    () =>
      staged
        ? sighting.frames.map(f => ({ ...f, annotation_json: JSON.stringify(decidedLabels(f, staged) ?? labelsOf(f)) }))
        : sighting.frames,
    [sighting.frames, staged],
  );
  const first = new Date(sighting.frames[0].captured_at),
    extra = staged ? 0 : sighting.frames.reduce((n, f) => n + overlapped(labelsOf(f), title).length, 0);
  useEffect(() => {
    strip.current?.querySelector('[aria-current=true]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [shown]);
  const turn = (step: number) => onPage(Math.max(0, Math.min(pages - 1, page + step)));
  const card = useRef<HTMLElement>(null),
    stage = useRef<HTMLDivElement>(null),
    top = useRef<HTMLDivElement>(null),
    caption = useRef<HTMLDivElement>(null);
  // Phones only: a touch laptop keeps its long-press menu.
  useHoldToPeek(stage, phone);
  const [choosing, setChoosing] = useState(false),
    [more, setMore] = useState(false),
    chooser = useId();
  useEffect(() => {
    if (current) return;
    setChoosing(false);
    setMore(false);
  }, [current]);
  // On a phone, chrome over the detection fades so the object stays in sight, and Undo moves off it.
  const [spot, setSpot] = useState<ScreenRect | null>(null),
    box = phone && current && shown >= lead ? spot : null;
  useEffect(() => {
    const element = card.current,
      root = element?.closest('.wk-reviewer');
    if (!element || !root || !phone || !current) return;
    const measure = () => {
      // The box is in card px. The card's own chrome moves with it, even mid-swipe; Undo is not in the
      // card, so it is placed against where the card settles, the feed.
      const at = element.getBoundingClientRect(),
        feed = element.closest('.wk-feed')?.getBoundingClientRect() ?? at;
      const under = (r: ScreenRect | undefined, from: ScreenRect) =>
        !!box &&
        !!r &&
        box.left < r.right - from.left &&
        box.right > r.left - from.left &&
        box.top < r.bottom - from.top &&
        box.bottom > r.top - from.top;
      const band = top.current?.getBoundingClientRect(),
        row = root.querySelector('.wk-undo-row')?.getBoundingClientRect(),
        undo = root.querySelector('.wk-undo')?.getBoundingClientRect();
      root.toggleAttribute('data-box-top', !!box && !!band && box.top < band.bottom - at.top);
      root.toggleAttribute('data-box-caption', under(caption.current?.getBoundingClientRect(), at));
      // Undo takes the other end of its row, and steps back only from an object under both ends.
      let place = null;
      if (row && undo) {
        const width = undo.right - undo.left,
          start = { left: row.left, right: row.left + width, top: undo.top, bottom: undo.bottom },
          end = { left: row.right - width, right: row.right, top: undo.top, bottom: undo.bottom };
        if (under(start, feed)) place = under(end, feed) ? 'both' : 'end';
      }
      if (place) root.setAttribute('data-box-undo', place);
      else root.removeAttribute('data-box-undo');
    };
    measure();
    // Again once the caption has stepped up and Undo has risen into place.
    root.addEventListener('transitionend', measure);
    root.addEventListener('animationend', measure);
    return () => {
      root.removeEventListener('transitionend', measure);
      root.removeEventListener('animationend', measure);
      root.removeAttribute('data-box-top');
      root.removeAttribute('data-box-caption');
      root.removeAttribute('data-box-undo');
    };
  }, [phone, current, box?.left, box?.top, box?.right, box?.bottom, choosing, more, lifted, staged]);
  // Double-tap is Yes, like a like: it never clears a Yes already given.
  const lastTap = useRef(-Infinity),
    [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  function tap(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('button')) return;
    if (e.timeStamp - lastTap.current > 320) {
      lastTap.current = e.timeStamp;
      return;
    }
    lastTap.current = -Infinity;
    const rect = e.currentTarget.getBoundingClientRect();
    setBursts(b => [...b, { id: e.timeStamp, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    if (state !== 'accepted' || staged) onDecide('accepted', true);
  }
  const heading = staged || !best ? title : `${title} · ${Math.round(best * 100)}%`,
    meta = `${sighting.frames[0].cam} · ${first.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })} · ${sighting.frames.length} ${sighting.frames.length === 1 ? 'photo' : 'photos'}`;
  const classKeys = (id?: string, choose = onClass) => (
    <div className="wk-class-keys" id={id} role="group" aria-label="What it is">
      {classes.map((c, i) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.name === title}
          aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
          style={{ '--box': classColor(c.id), '--box-ink': classInk(c.id) } as CSSProperties}
          onClick={() => choose(c.name)}
        >
          <i />
          {c.name}
          {i < 9 && <kbd aria-hidden="true">{i + 1}</kbd>}
        </button>
      ))}
    </div>
  );
  return (
    <article
      ref={card}
      className="wk-card"
      aria-roledescription="sighting"
      aria-label={`Sighting ${index + 1} of ${total}: ${sightingClass(sighting)}`}
      data-current={current || undefined}
      data-lifted={lifted || undefined}
    >
      <div className="wk-card-stage" ref={stage} onClick={tap}>
        <div className="wk-pager" ref={pager} onScroll={onScroll}>
          {clip && (
            <section className="wk-slide" aria-label="Video">
              <SightingClip
                sighting={sighting}
                clip={clip}
                active={current && page === 0}
                zoomed={zoomed}
                speed={speed}
                player={player}
              />
            </section>
          )}
          {frames.map((frame, i) => (
            <section key={frame.id} className="wk-slide" aria-label={`Photo ${i + 1} of ${frames.length}`}>
              {Math.abs(i + lead - shown) <= 1 && (
                <FrameStage
                  item={frame}
                  zoomed={zoomed}
                  active={current && i + lead === shown}
                  prefer={title}
                  onBox={phone && current && i + lead === shown ? setSpot : undefined}
                />
              )}
            </section>
          ))}
        </div>
        <div className="wk-card-top" ref={top}>
          <span className="wk-glass wk-page-pill">
            {clip && shown === 0 ? (
              <>
                <Video />
                Video
              </>
            ) : (
              `Photo ${shown - lead + 1} of ${sighting.frames.length}`
            )}
          </span>
          <button
            type="button"
            className="wk-glass wk-glass-button wk-open-on"
            onClick={onOpenOn}
            aria-pressed={open === 'photo'}
            title="Open each sighting on its video or its surest photo"
            aria-label={`Opens sightings on ${open === 'photo' ? 'the photo' : 'the video'}`}
          >
            {open === 'photo' ? <ImageIcon /> : <Video />}
            <span>{open === 'photo' ? 'Photo first' : 'Video first'}</span>
          </button>
          {clip && shown === 0 && (
            <button
              type="button"
              className="wk-glass wk-glass-button wk-speed"
              onClick={onSpeed}
              title="Playback speed"
              aria-label={`Playback speed, ${speed} times`}
            >
              {speed}×
            </button>
          )}
          <button
            type="button"
            className="wk-glass wk-glass-button wk-zoom"
            onClick={onZoom}
            aria-pressed={zoomed}
            title="Zoom (Z)"
            aria-label={zoomed ? 'Show full frame' : 'Zoom to object'}
          >
            {zoomed ? <Maximize2 /> : <ScanSearch />}
            <span>{zoomed ? 'Full frame' : 'Object'}</span>
          </button>
          <button
            type="button"
            className="wk-glass wk-glass-button wk-to-grid"
            onClick={onGrid}
            title="Batch grid (G)"
            aria-label="Show this batch as a grid"
          >
            <LayoutGrid />
            <span>Grid</span>
          </button>
        </div>
        {bursts.map(b => (
          <span
            key={b.id}
            className="wk-burst"
            aria-hidden="true"
            style={{ left: b.x, top: b.y }}
            onAnimationEnd={() => setBursts(all => all.filter(x => x !== b))}
          >
            <Check />
          </span>
        ))}
        {current && page > 0 && (
          <button
            type="button"
            className="wk-glass wk-page-step"
            data-side="left"
            aria-label="Previous page"
            onClick={() => turn(-1)}
          >
            <ChevronLeft />
          </button>
        )}
        {current && page < pages - 1 && (
          <button
            type="button"
            className="wk-glass wk-page-step"
            data-side="right"
            aria-label="Next page"
            onClick={() => turn(1)}
          >
            <ChevronRight />
          </button>
        )}
        <div className="wk-page-dots" aria-hidden="true">
          {Array.from({ length: Math.min(pages, 12) }, (_, i) => (
            <i key={i} data-on={i === Math.min(shown, 11) || undefined} />
          ))}
        </div>
      </div>
      <footer className="wk-card-footer">
        {phone ? (
          <div className="wk-card-caption" ref={caption}>
            <h2 className="wk-card-title">
              {classes.length > 1 ? (
                <button
                  type="button"
                  aria-expanded={choosing}
                  aria-controls={chooser}
                  title="What it is"
                  onClick={() => setChoosing(c => !c)}
                >
                  {heading}
                  <ChevronDown aria-hidden="true" />
                </button>
              ) : (
                heading
              )}
            </h2>
            {choosing &&
              classKeys(chooser, name => {
                setChoosing(false);
                onClass(name);
              })}
            <p className="wk-card-meta">
              <button type="button" aria-expanded={more} onClick={() => setMore(m => !m)}>
                {meta} · {bucket}
              </button>
            </p>
            {(state === 'mixed' || staged || extra > 0) && (
              <p className="wk-card-notes">
                {state === 'mixed' && <span>Mixed</span>}
                {staged && <span data-kind="staged">Changed · tap Confirm to save</span>}
                {extra > 0 && state !== 'accepted' && (
                  <span data-kind="overlap">
                    Confirm removes {extra} overlapping {extra === 1 ? 'box' : 'boxes'}
                  </span>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="wk-card-caption">
            <p className="wk-card-chips">
              <span>{bucket}</span>
              {state === 'mixed' && <span>Mixed</span>}
              {staged && <span data-kind="staged">Changed · press ⏎ to save</span>}
              {extra > 0 && state !== 'accepted' && (
                <span data-kind="overlap">
                  Confirm removes {extra} overlapping {extra === 1 ? 'box' : 'boxes'}
                </span>
              )}
            </p>
            <h2>{title}</h2>
            {classes.length > 1 && classKeys()}
            <p>
              {sighting.frames[0].cam} · {first.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })} ·{' '}
              {sighting.frames.length} {sighting.frames.length === 1 ? 'photo' : 'photos'}
              {best ? ` · ${Math.round(best * 100)}%` : ''}
            </p>
          </div>
        )}
        {/* A row under the stage on wide screens, a rail up the right edge on phones. */}
        <div className="wk-actions">
          <button type="button" className="wk-action" onClick={onEdit} title="Edit labels (E)" aria-label="Edit labels">
            <span>
              <Pencil />
            </span>
            <small>Edit</small>
          </button>
          {children}
          <div className="wk-decide" role="group" aria-label="Decision">
            <button
              type="button"
              data-choice="no"
              aria-pressed={state === 'rejected'}
              aria-keyshortcuts="N"
              title="None of the model's classes (N)"
              onClick={() => onDecide('rejected')}
            >
              <span>
                <X />
              </span>
              None<kbd aria-hidden="true">N</kbd>
            </button>
            <button
              type="button"
              data-choice="yes"
              aria-pressed={state === 'accepted' && !staged}
              aria-keyshortcuts="Enter Y"
              title={`Confirm as ${title} and go on (Enter)`}
              onClick={() => onDecide('accepted')}
            >
              <span>
                <Check />
              </span>
              Confirm<kbd aria-hidden="true">⏎</kbd>
            </button>
          </div>
        </div>
        {current && (
          <div className="wk-filmstrip" ref={strip} role="group" aria-label="Pages">
            {clip && (
              <button type="button" aria-current={page === 0} aria-label="Video" onClick={() => onPage(0)}>
                <Video />
              </button>
            )}
            {sighting.frames.map((frame, i) => (
              <button
                key={frame.id}
                type="button"
                aria-current={page === i + lead}
                aria-label={`Photo ${i + 1}`}
                data-review={frame.review}
                onClick={() => onPage(i + lead)}
              >
                <img src={thumbnailUrl(frame, true, true)} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </footer>
    </article>
  );
}
