import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  SquareDashed,
  Tag,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import type { WorkshopAnnotation, WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { BoxHandle, Camera, ReviewDecision } from '../models/reviewInferencemodel';
import { useViewSize } from '../hooks/use-view-size';
import { useBackToClose } from '../../../hooks/use-back-to-close';
import {
  clampCamera,
  fitScale,
  focusCamera,
  framePoint,
  layerStyle,
  screenBox,
  zoomCamera,
} from '../utils/reviewCameraInferenceUtil';
import { dragBox, imageGeometry, spanBox } from '../utils/reviewGeometryInferenceUtil';
import { classColor, labelsOf, modelClasses, topBox } from '../utils/sightingInferenceUtil';

type Save = (
  item: WorkshopRunImage,
  review: ReviewDecision,
  annotations?: WorkshopAnnotation[],
) => Promise<WorkshopRunImage>;
type Drag =
  | { kind: 'pan'; x: number; y: number; camera: Camera }
  | { kind: 'pinch'; span: number; x: number; y: number; camera: Camera }
  | {
      kind: 'edit';
      index: number;
      handle: BoxHandle;
      start: number[];
      box: number[];
      before: WorkshopAnnotation[];
      moved: boolean;
    }
  | { kind: 'draw'; start: number[] };

const MAX_SCALE = 16;
const HANDLES: [BoxHandle, number, number][] = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
];
// A fingertip gets bigger handles, at the corners only, so a thin streak's box keeps room to drag it by.
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const GRIP = touch ? 8 : 5,
  GRIPS = touch ? HANDLES.filter(([handle]) => handle.length === 2) : HANDLES;
const same = (a: WorkshopAnnotation[], b: WorkshopAnnotation[]) =>
  JSON.stringify(a.map(l => [l.class_name, l.box])) === JSON.stringify(b.map(l => [l.class_name, l.box]));
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable=true]');

/** Full-screen label editing for one sighting's photos, one photo at a time. */
export function AnnotationEditor({
  frames,
  start,
  onSave,
  onClose,
  onDirty,
}: {
  frames: WorkshopRunImage[];
  start: number;
  onSave: Save;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [index, setIndex] = useState(start);
  const lastClass = useRef(''),
    back = useRef(() => true);
  useBackToClose(true, () => back.current());
  const item = frames[index];
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="wk-annotator dark"
          aria-describedby={undefined}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Edit labels</DialogPrimitive.Title>
          <FrameEditor
            key={item.id}
            item={item}
            index={index}
            count={frames.length}
            lastClass={lastClass}
            back={back}
            onSave={onSave}
            onDirty={onDirty}
            onClose={onClose}
            onOpen={next => {
              if (next >= frames.length) onClose();
              else setIndex(Math.max(0, next));
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FrameEditor({
  item,
  index,
  count,
  lastClass,
  back,
  onSave,
  onDirty,
  onClose,
  onOpen,
}: {
  item: WorkshopRunImage;
  index: number;
  count: number;
  lastClass: { current: string };
  back: { current: () => boolean };
  onSave: Save;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onOpen: (index: number) => void;
}) {
  const { width, height } = imageGeometry(item),
    frame = useMemo(() => ({ width, height }), [width, height]);
  const classes = modelClasses(item),
    original = useMemo(() => labelsOf(item), [item.annotation_json]);
  const [labels, setLabels] = useState(original),
    [past, setPast] = useState<WorkshopAnnotation[][]>([]),
    [future, setFuture] = useState<WorkshopAnnotation[][]>([]);
  const [selected, setSelected] = useState<number | null>(() =>
    original.reduce<number | null>(
      (best, l, i) => (l.box && (best === null || l.confidence > original[best].confidence) ? i : best),
      null,
    ),
  );
  const [tool, setTool] = useState<'select' | 'box'>('select'),
    [hidden, setHidden] = useState<number[]>([]),
    [picking, setPicking] = useState<number | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null),
    [panning, setPanning] = useState(false),
    [space, setSpace] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirming, setConfirming] = useState(false);
  const [ref, view] = useViewSize<HTMLDivElement>();
  const [camera, setCamera] = useState<Camera | null>(null);
  const focus = view.width ? focusCamera(view, frame, topBox(item), 6, MAX_SCALE) : null;
  const cam = camera && view.width ? clampCamera(view, frame, camera) : focus;
  const drag = useRef<Drag | null>(null),
    live = useRef({ cam, view });
  live.current = { cam, view };
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const dirty = !same(labels, original),
    editable = classes.length > 0;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  function change(next: WorkshopAnnotation[]) {
    setPast(p => [...p, labels]);
    setFuture([]);
    setLabels(next);
    setError('');
  }
  function setClass(at: number, choice: { id: number; name: string }) {
    lastClass.current = choice.name;
    setPicking(null);
    if (labels[at]?.class_name !== choice.name)
      change(labels.map((l, i) => (i === at ? { ...l, class_id: choice.id, class_name: choice.name } : l)));
  }
  function remove(at: number) {
    change(labels.filter((_, i) => i !== at));
    setSelected(null);
    setPicking(null);
    setHidden(h => h.filter(i => i !== at).map(i => (i > at ? i - 1 : i)));
  }
  function undo() {
    if (!past.length) return;
    setFuture(f => [labels, ...f]);
    setLabels(past.at(-1)!);
    setPast(p => p.slice(0, -1));
    setSelected(null);
    setPicking(null);
  }
  function redo() {
    if (!future.length) return;
    setPast(p => [...p, labels]);
    setLabels(future[0]);
    setFuture(f => f.slice(1));
    setSelected(null);
    setPicking(null);
  }
  function zoom(factor: number) {
    if (cam) setCamera(zoomCamera(view, frame, cam, factor, { x: view.width / 2, y: view.height / 2 }, MAX_SCALE));
  }
  const fit = () => setCamera(focusCamera(view, frame));
  /** Saves labels if changed, with `review`; false when the save failed and the edits stay on screen. */
  async function commit(review: ReviewDecision) {
    if (review === item.review && !dirty) return true;
    setBusy(true);
    setError('');
    try {
      const next = await onSave(item, review, dirty ? labels : undefined);
      setLabels(labelsOf(next));
      setPast([]);
      setFuture([]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const open = async (next: number) => {
    if (!busy && next >= 0 && next < count && (await commit(item.review))) onOpen(next);
  };
  const decide = async (review: ReviewDecision) => {
    if (!busy && (await commit(review))) onOpen(index + 1);
  };
  const done = async () => {
    if (!busy && (await commit(item.review))) onClose();
  };
  const close = () => (dirty ? setConfirming(true) : onClose());
  // Back asks about unsaved edits like Cancel does, and stays open while it asks.
  useEffect(() => {
    back.current = () => {
      close();
      return !dirty;
    };
  });
  // Esc steps back one thing at a time; the Cancel button closes at once.
  const cancel = () => {
    if (picking !== null) setPicking(null);
    else if (selected !== null) setSelected(null);
    else close();
  };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Two-finger scroll pans and a pinch (or ⌘/Ctrl + scroll) zooms, as in Mac design apps.
    const wheel = (e: WheelEvent) => {
      const { cam, view } = live.current;
      if (!cam) return;
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      setCamera(
        e.ctrlKey || e.metaKey
          ? zoomCamera(
              view,
              frame,
              cam,
              Math.exp(-e.deltaY * 0.01),
              { x: e.clientX - rect.left, y: e.clientY - rect.top },
              MAX_SCALE,
            )
          : clampCamera(view, frame, { ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY }),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [frame]);
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (typing(e.target) || confirming) return;
      const key = e.key.toLowerCase(),
        meta = e.metaKey || e.ctrlKey,
        target = picking ?? selected;
      if (key === 'escape') cancel();
      else if (meta && key === 'z') e.shiftKey ? redo() : undo();
      else if (meta && (key === 's' || key === 'enter')) void done();
      else if (meta || e.altKey) return;
      else if (key === ' ') setSpace(true);
      else if (key === 'v') setTool('select');
      else if (key === 'b' && editable) setTool('box');
      else if ((key === 'delete' || key === 'backspace') && selected !== null) remove(selected);
      else if (/^[1-9]$/.test(key) && target !== null && classes[+key - 1]) setClass(target, classes[+key - 1]);
      else if (key === 'y') void decide('accepted');
      else if (key === 'n') void decide('rejected');
      else if (key === 'arrowleft') void open(index - 1);
      else if (key === 'arrowright') void open(index + 1);
      else if (key === '=' || key === '+') zoom(1.4);
      else if (key === '-') zoom(1 / 1.4);
      else if (key === '0') fit();
      else return;
      e.preventDefault();
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  function point(e: ReactPointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  /** The distance between two fingers and the point halfway between them. */
  function pinch() {
    const [a, b] = [...touches.current.values()];
    return { span: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function pointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!cam || busy || e.button === 2) return;
    touches.current.set(e.pointerId, point(e));
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // A second finger turns whatever the first began into a pinch.
    if (touches.current.size === 2) {
      const d = drag.current;
      if (d?.kind === 'edit' && d.moved) setLabels(d.before);
      drag.current = { kind: 'pinch', ...pinch(), camera: cam };
      setDraft(null);
      setPanning(false);
      return;
    }
    const { x, y } = point(e),
      hit = (e.target as Element).closest?.('[data-index]');
    const at = hit ? Number(hit.getAttribute('data-index')) : null,
      handle = hit?.getAttribute('data-handle') as BoxHandle | null;
    setPicking(null);
    if (space || e.button === 1 || !editable || (tool === 'select' && at === null)) {
      if (at === null && tool === 'select') setSelected(null);
      drag.current = { kind: 'pan', x, y, camera: cam };
      setPanning(true);
    } else if (at !== null && handle && (tool === 'select' || handle !== 'move')) {
      setSelected(at);
      drag.current = {
        kind: 'edit',
        index: at,
        handle,
        start: framePoint(frame, cam, x, y),
        box: labels[at].box!,
        before: labels,
        moved: false,
      };
    } else drag.current = { kind: 'draw', start: framePoint(frame, cam, x, y) };
  }
  function pointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, point(e));
    const d = drag.current;
    if (!d || !cam) return;
    const { x, y } = point(e);
    if (d.kind === 'pinch') {
      const p = pinch(),
        zoomed = zoomCamera(view, frame, d.camera, p.span / d.span, d, MAX_SCALE);
      setCamera(clampCamera(view, frame, { ...zoomed, x: zoomed.x + p.x - d.x, y: zoomed.y + p.y - d.y }));
      return;
    }
    if (d.kind === 'pan') {
      setCamera(clampCamera(view, frame, { scale: d.camera.scale, x: d.camera.x + x - d.x, y: d.camera.y + y - d.y }));
      return;
    }
    const p = framePoint(frame, cam, x, y);
    if (d.kind === 'draw') {
      setDraft(spanBox(d.start, p));
      return;
    }
    d.moved = true;
    const box = dragBox(d.box, d.handle, p[0] - d.start[0], p[1] - d.start[1], [2 / width, 2 / height]);
    setLabels(current => current.map((l, i) => (i === d.index ? { ...l, box } : l)));
  }
  // The box comes from where the pointer lifts: the last move's draft may not have rendered yet.
  function pointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    setDraft(null);
    touches.current.delete(e.pointerId);
    if (d?.kind === 'edit' && d.moved) {
      setPast(p => [...p, d.before]);
      setFuture([]);
    }
    if (d?.kind !== 'draw' || e.type === 'pointercancel' || !cam) return;
    const { x, y } = point(e),
      box = spanBox(d.start, framePoint(frame, cam, x, y)),
      size = screenBox(frame, cam, box);
    if (size.width < 4 || size.height < 4) return;
    const choice = classes.find(c => c.name === lastClass.current) ?? classes[0];
    change([
      ...labels,
      { class_id: choice.id, class_name: choice.name, confidence: 1, model_node: original[0]?.model_node ?? '', box },
    ]);
    setSelected(labels.length);
    if (classes.length > 1) setPicking(labels.length);
  }
  function show(at: number) {
    setSelected(at);
    if (labels[at].box && view.width) setCamera(focusCamera(view, frame, labels[at].box, 6, MAX_SCALE));
  }

  const boxes = labels.map((l, i) => (cam && l.box && !hidden.includes(i) ? screenBox(frame, cam, l.box) : null));
  const changed = (label: WorkshopAnnotation, i: number) =>
    label.edited || !original[i] || !same([label], [original[i]]);
  const pickerBox = picking !== null ? boxes[picking] : null;
  return (
    <div className="wk-editor-layout">
      <header className="wk-editor-bar">
        <div className="wk-editor-lead">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <div className="wk-editor-step">
            <button
              type="button"
              className="wk-icon-button"
              aria-label="Previous photo"
              disabled={busy || index === 0}
              onClick={() => void open(index - 1)}
            >
              <ChevronLeft />
            </button>
            <div>
              <strong>
                Photo {index + 1} of {count}
              </strong>
              <small>
                {new Date(item.captured_at).toLocaleTimeString()} · {item.cam}
              </small>
            </div>
            <button
              type="button"
              className="wk-icon-button"
              aria-label="Next photo"
              disabled={busy || index === count - 1}
              onClick={() => void open(index + 1)}
            >
              <ChevronRight />
            </button>
          </div>
        </div>
        <div className="wk-editor-tools" role="toolbar" aria-label="Tools">
          <button
            type="button"
            className="wk-icon-button"
            aria-pressed={tool === 'select'}
            aria-label="Select and move"
            title="Select (V)"
            onClick={() => setTool('select')}
          >
            <MousePointer2 />
          </button>
          <button
            type="button"
            className="wk-icon-button"
            aria-pressed={tool === 'box'}
            aria-label="Draw box"
            title="Draw box (B)"
            disabled={!editable}
            onClick={() => setTool('box')}
          >
            <SquareDashed />
          </button>
          <span className="wk-divider" />
          <button
            type="button"
            className="wk-icon-button"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 />
          </button>
          <button
            type="button"
            className="wk-icon-button"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 />
          </button>
          <span className="wk-divider" />
          <button
            type="button"
            className="wk-icon-button"
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => zoom(1 / 1.4)}
          >
            <Minus />
          </button>
          <button type="button" className="wk-zoom-level" title="Fit (0)" onClick={fit}>
            {cam ? Math.round(cam.scale * 100) : 100}%
          </button>
          <button
            type="button"
            className="wk-icon-button"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => zoom(1.4)}
          >
            <Plus />
          </button>
        </div>
        <div className="wk-editor-trail">
          <Button onClick={() => void done()} disabled={busy}>
            {busy ? 'Saving…' : 'Done'}
          </Button>
        </div>
      </header>
      <div
        className="wk-editor-canvas"
        ref={ref}
        data-tool={space ? 'pan' : tool}
        data-panning={panning || undefined}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onDoubleClick={() =>
          setCamera(
            cam && focus && Math.abs(cam.scale - fitScale(view, frame)) < 1e-6 ? focus : focusCamera(view, frame),
          )
        }
      >
        {cam && (
          <>
            <img
              className="wk-stage-layer"
              src={item.image_url}
              alt={`Photo ${index + 1}`}
              draggable={false}
              style={layerStyle(frame, cam)}
            />
            <svg className="wk-editor-overlay" role="img" aria-label="Labels">
              {boxes.map((s, i) => {
                if (!s) return null;
                const label = labels[i];
                return (
                  <g
                    key={i}
                    style={{ '--box': classColor(label.class_id) } as CSSProperties}
                    data-selected={selected === i || undefined}
                  >
                    <rect
                      className="wk-edit-box"
                      data-index={i}
                      data-handle="move"
                      x={s.left}
                      y={s.top}
                      width={s.width}
                      height={s.height}
                    />
                    {selected === i &&
                      editable &&
                      GRIPS.map(([handle, hx, hy]) => (
                        <rect
                          key={handle}
                          className="wk-edit-handle"
                          data-index={i}
                          data-handle={handle}
                          x={s.left + s.width * hx - GRIP}
                          y={s.top + s.height * hy - GRIP}
                          width={GRIP * 2}
                          height={GRIP * 2}
                          rx={GRIP / 2}
                        />
                      ))}
                  </g>
                );
              })}
              {draft &&
                (() => {
                  const s = screenBox(frame, cam, draft);
                  return <rect className="wk-edit-draft" x={s.left} y={s.top} width={s.width} height={s.height} />;
                })()}
            </svg>
            {boxes.map(
              (s, i) =>
                s && (
                  <span
                    key={i}
                    className="wk-edit-tag"
                    style={{ left: s.left, top: s.top, '--box': classColor(labels[i].class_id) } as CSSProperties}
                  >
                    {labels[i].class_name}
                  </span>
                ),
            )}
            {pickerBox && (
              <div
                className="wk-class-picker"
                role="menu"
                aria-label="Choose a class"
                style={{ left: pickerBox.left, top: pickerBox.top + pickerBox.height + 8 }}
                onPointerDown={e => e.stopPropagation()}
              >
                {classes.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitem"
                    autoFocus={c.name === labels[picking!].class_name}
                    onClick={() => setClass(picking!, c)}
                  >
                    <i style={{ background: classColor(c.id) }} />
                    {c.name}
                    {i < 9 && <kbd>{i + 1}</kbd>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <aside className="wk-editor-panel" aria-label="Labels and review">
        <section>
          <h3>
            Objects <span>{labels.length}</span>
          </h3>
          {!labels.length && (
            <p className="wk-editor-hint">{editable ? 'No objects. Press B, then drag to draw one.' : 'No objects.'}</p>
          )}
          <ul>
            {labels.map((label, i) => (
              <li key={i} data-selected={selected === i || undefined}>
                <button type="button" className="wk-object" onClick={() => show(i)}>
                  <i style={{ background: classColor(label.class_id) }} />
                  <strong>{label.class_name}</strong>
                  <small>{changed(label, i) ? 'Edited' : `${Math.round(label.confidence * 100)}%`}</small>
                </button>
                {editable && classes.length > 1 && (
                  <button
                    type="button"
                    className="wk-icon-button"
                    aria-label={`Change class of object ${i + 1}`}
                    onClick={() => {
                      setSelected(i);
                      setPicking(i);
                    }}
                  >
                    <Tag />
                  </button>
                )}
                <button
                  type="button"
                  className="wk-icon-button"
                  aria-label={hidden.includes(i) ? `Show object ${i + 1}` : `Hide object ${i + 1}`}
                  onClick={() => setHidden(h => (h.includes(i) ? h.filter(n => n !== i) : [...h, i]))}
                >
                  {hidden.includes(i) ? <EyeOff /> : <Eye />}
                </button>
                {editable && (
                  <button
                    type="button"
                    className="wk-icon-button"
                    aria-label={`Delete object ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <Trash2 />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
        {editable ? (
          <section>
            <h3>Classes</h3>
            <ol className="wk-editor-classes">
              {classes.map((c, i) => (
                <li key={c.id}>
                  <i style={{ background: classColor(c.id) }} />
                  {c.name}
                  {i < 9 && <kbd>{i + 1}</kbd>}
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <p className="wk-editor-hint">This photo has no model classes, so its labels can’t be edited.</p>
        )}
        <section className="wk-editor-review">
          <h3>This photo</h3>
          <div className="wk-decide">
            <button
              type="button"
              data-choice="no"
              aria-pressed={item.review === 'rejected'}
              aria-keyshortcuts="N"
              disabled={busy}
              onClick={() => void decide('rejected')}
            >
              <X />
              No<kbd aria-hidden="true">N</kbd>
            </button>
            <button
              type="button"
              data-choice="yes"
              aria-pressed={item.review === 'accepted'}
              aria-keyshortcuts="Y"
              disabled={busy}
              onClick={() => void decide('accepted')}
            >
              <Check />
              Yes<kbd aria-hidden="true">Y</kbd>
            </button>
          </div>
          <p className="wk-editor-hint">Saves your edits, then opens the next photo.</p>
          {error && (
            <p role="alert" className="wk-editor-error">
              {error}
            </p>
          )}
        </section>
      </aside>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="dark">
          <DialogTitle>Discard your label changes?</DialogTitle>
          <DialogDescription>This photo has edits that haven’t been saved.</DialogDescription>
          <Button onClick={() => setConfirming(false)}>Keep editing</Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirming(false);
              onClose();
            }}
          >
            Discard changes
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
