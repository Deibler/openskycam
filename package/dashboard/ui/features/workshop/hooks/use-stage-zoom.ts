import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Camera, Size } from '../models/reviewInferencemodel';
import { clampCamera, zoomCamera } from '../utils/reviewCameraInferenceUtil';

const MAX_SCALE = 8;
type SafariGesture = Event & { scale: number; clientX: number; clientY: number };

/**
 * Looking closer than a stage's own framing, as in the recording player: a pinch, ⌘/Ctrl-scroll or
 * trackpad pinch zooms, and once zoomed a drag or scroll pans. Unzoomed, one finger and plain scrolls
 * pass through to the feed. `null` look means the stage's own framing; leaving the page resets it.
 */
export function useStageZoom(
  stage: RefObject<HTMLElement | null>,
  view: Size,
  frame: Size,
  base: Camera,
  reset: unknown,
) {
  const [look, setLook] = useState<Camera | null>(null);
  const camera = look && view.width ? clampCamera(view, frame, look) : base;
  const live = useRef({ camera, view, frame, look });
  live.current = { camera, view, frame, look };
  useEffect(() => setLook(null), [reset]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: { span: number; x: number; y: number; camera: Camera } | null = null,
      moved = false,
      native: { camera: Camera; x: number; y: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = element.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pair = () => {
      const [a, b] = [...pointers.values()];
      return b
        ? { span: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        : { span: 1, ...a };
    };
    // Two fingers pinch; one pans only once zoomed, so an unzoomed swipe still moves the feed.
    const start = () => {
      gesture =
        pointers.size >= 2 || (pointers.size && live.current.look) ? { ...pair(), camera: live.current.camera } : null;
    };
    const down = (e: PointerEvent) => {
      moved = false;
      if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target as Element).closest('button')) return;
      pointers.set(e.pointerId, local(e));
      start();
      if (gesture && e.pointerType === 'mouse') element.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, local(e));
      if (!gesture) return;
      const p = pair(),
        { view, frame } = live.current;
      if (Math.abs(p.x - gesture.x) + Math.abs(p.y - gesture.y) + Math.abs(p.span - gesture.span) > 4) moved = true;
      const zoomed = zoomCamera(view, frame, gesture.camera, p.span / gesture.span, gesture, MAX_SCALE);
      setLook(clampCamera(view, frame, { ...zoomed, x: zoomed.x + p.x - gesture.x, y: zoomed.y + p.y - gesture.y }));
    };
    const up = (e: PointerEvent) => {
      if (pointers.delete(e.pointerId)) start();
    };
    // A pan ends in a click on the stage, which would otherwise pause the clip or count toward a double-tap.
    const click = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation();
        moved = false;
      }
    };
    const wheel = (e: WheelEvent) => {
      const { camera, view, frame, look } = live.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setLook(zoomCamera(view, frame, camera, Math.exp(-e.deltaY * 0.01), local(e), MAX_SCALE));
      } else if (look) {
        e.preventDefault();
        setLook(clampCamera(view, frame, { ...camera, x: camera.x - e.deltaX, y: camera.y - e.deltaY }));
      }
    };
    // Safari pinches with gesture events; on a touch screen the pointers above already handle it.
    const gestureStart = (e: Event) => {
      e.preventDefault();
      native = pointers.size < 2 ? { camera: live.current.camera, ...local(e as SafariGesture) } : null;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const { view, frame } = live.current;
      if (native && pointers.size < 2)
        setLook(zoomCamera(view, frame, native.camera, (e as SafariGesture).scale, native, MAX_SCALE));
    };
    const gestureEnd = (e: Event) => {
      e.preventDefault();
      native = null;
    };
    const events: [string, EventListener, AddEventListenerOptions?][] = [
      ['pointerdown', down as EventListener],
      ['pointermove', move as EventListener],
      ['pointerup', up as EventListener],
      ['pointercancel', up as EventListener],
      ['click', click as EventListener, { capture: true }],
      ['wheel', wheel as EventListener, { passive: false }],
      ['gesturestart', gestureStart, { passive: false }],
      ['gesturechange', gestureChange, { passive: false }],
      ['gestureend', gestureEnd, { passive: false }],
    ];
    for (const [type, listener, options] of events) element.addEventListener(type, listener, options);
    return () => {
      for (const [type, listener, options] of events) element.removeEventListener(type, listener, options);
    };
  }, [stage]);
  return { camera, zoomed: look !== null, setLook, reset: () => setLook(null) };
}
