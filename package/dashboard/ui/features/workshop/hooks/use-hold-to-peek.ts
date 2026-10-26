import { type RefObject, useEffect } from 'react';

const HOLD_MS = 250,
  SLOP = 8;

/**
 * A finger held still on `ref`, not on a control, shows the photo alone: the reviewer has `data-peek`
 * until it lifts. Moving first, a second finger, or a scroll taking over cancels it, so swipes,
 * pinches and pans work as before; lifting after a peek is not a tap. Off while `enabled` is false.
 */
export function useHoldToPeek(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      held: { id: number; x: number; y: number } | null = null,
      peeking = false,
      swallow = 0;
    const root = () => element.closest('.wk-reviewer');
    const end = () => {
      clearTimeout(timer);
      held = null;
      if (!peeking) return;
      peeking = false;
      root()?.removeAttribute('data-peek');
      swallow = performance.now() + 400;
    };
    const down = (e: PointerEvent) => {
      if (held) return end();
      if (e.pointerType !== 'touch' || (e.target as Element).closest('button, a')) return;
      held = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        peeking = true;
        root()?.setAttribute('data-peek', '');
      }, HOLD_MS);
    };
    const move = (e: PointerEvent) => {
      if (held?.id === e.pointerId && !peeking && Math.hypot(e.clientX - held.x, e.clientY - held.y) > SLOP) end();
    };
    const up = (e: PointerEvent) => {
      if (held?.id === e.pointerId) end();
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < swallow) e.stopPropagation();
      swallow = 0;
    };
    // A long press would otherwise open the image's menu.
    const menu = (e: Event) => {
      if (held || peeking) e.preventDefault();
    };
    const events: [string, EventListener, AddEventListenerOptions?][] = [
      ['pointerdown', down as EventListener],
      ['pointermove', move as EventListener],
      ['pointerup', up as EventListener],
      ['pointercancel', up as EventListener],
      ['click', click as EventListener, { capture: true }],
      ['contextmenu', menu],
    ];
    for (const [type, listener, options] of events) element.addEventListener(type, listener, options);
    return () => {
      end();
      for (const [type, listener, options] of events) element.removeEventListener(type, listener, options);
    };
  }, [ref, enabled]);
}
