import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

export type ControlsMode = 'auto' | 'visible' | 'minimized';
type Position = { x: number; y: number };
type Preferences = { mode: ControlsMode; restoreMode: 'auto' | 'visible'; position: Position };
const KEY = 'skyvision-player-controls';
export const CONTROLS_IDLE_MS = 5000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const origin: Position = { x: 0.5, y: 1 };
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      mode: ['auto', 'visible', 'minimized'].includes(saved.mode) ? saved.mode : 'auto',
      restoreMode: saved.restoreMode === 'visible' ? 'visible' : 'auto',
      position:
        Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)
          ? { x: clamp(saved.position.x), y: clamp(saved.position.y) }
          : origin,
    };
  } catch {
    return { mode: 'auto', restoreMode: 'auto', position: origin };
  }
}

/** Keeps automatic hiding separate from the user's saved visibility and position. */
export function usePlayerControls({
  frame,
  dock,
  enabled,
  zoom,
  playing,
  ready,
  blocked,
}: {
  frame: RefObject<HTMLElement | null>;
  dock: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  zoom: number;
  playing: boolean;
  ready: boolean;
  blocked: boolean;
}) {
  const [preferences, setPreferences] = useState(readPreferences);
  const saved = useRef(preferences);
  saved.current = preferences;
  const [autoHidden, setAutoHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [positionStyle, setPositionStyle] = useState<CSSProperties>({});
  const position = useRef(preferences.position);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; initial: Position } | null>(null);
  const lastActivity = useRef(Date.now());
  const zoomGrace = useRef(0);
  const minimized = enabled && (preferences.mode === 'minimized' || autoHidden);

  const persist = useCallback((next: Preferences) => {
    saved.current = next;
    setPreferences(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Controls still work without storage. */
    }
  }, []);
  const activity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);
  const setMode = useCallback(
    (mode: ControlsMode) => {
      activity();
      zoomGrace.current = Date.now() + CONTROLS_IDLE_MS;
      setAutoHidden(false);
      persist({ ...saved.current, mode, restoreMode: mode === 'minimized' ? saved.current.restoreMode : mode });
    },
    [persist, activity],
  );
  const restore = useCallback(() => {
    activity();
    zoomGrace.current = Date.now() + CONTROLS_IDLE_MS;
    setAutoHidden(false);
    if (saved.current.mode === 'minimized') persist({ ...saved.current, mode: saved.current.restoreMode });
  }, [persist, activity]);

  function hasKeyboardFocus() {
    const target = document.activeElement;
    return Boolean(
      target &&
        dock.current?.contains(target) &&
        target.matches('input, [role="slider"]:focus-visible, button:focus-visible'),
    );
  }
  useEffect(() => {
    if (!enabled || preferences.mode !== 'auto' || !playing || !ready || blocked || dragging || autoHidden) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = CONTROLS_IDLE_MS - (Date.now() - lastActivity.current);
      if (remaining > 0) timer = setTimeout(check, remaining);
      else if (hasKeyboardFocus()) timer = setTimeout(check, CONTROLS_IDLE_MS);
      else setAutoHidden(true);
    };
    lastActivity.current = Date.now();
    timer = setTimeout(check, CONTROLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, preferences.mode, playing, ready, blocked, dragging, autoHidden]);
  useEffect(() => {
    if (!enabled || preferences.mode !== 'auto' || zoom <= 1 || blocked || dragging || Date.now() < zoomGrace.current)
      return;
    // Wait until zoom settles. Parking the controls never resizes the video.
    const timer = setTimeout(() => {
      if (!hasKeyboardFocus()) setAutoHidden(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [enabled, preferences.mode, zoom, blocked, dragging]);

  const bounds = useCallback(() => {
    const area = frame.current?.getBoundingClientRect();
    const panel = dock.current?.getBoundingClientRect();
    if (!area?.width || !area.height || !panel?.width || !panel.height) return null;
    const left = Math.min(12, Math.max(0, (area.width - panel.width) / 2));
    const top = Math.min(24, Math.max(0, area.height - panel.height));
    return {
      left,
      top,
      x: Math.max(0, area.width - panel.width - left * 2),
      y: Math.max(0, area.height - panel.height - top - 12),
    };
  }, [frame, dock]);
  const place = useCallback(
    (next: Position) => {
      position.current = { x: clamp(next.x), y: clamp(next.y) };
      const room = bounds();
      if (!room) return;
      setPositionStyle({
        left: room.left + room.x * position.current.x,
        top: room.top + room.y * position.current.y,
        right: 'auto',
        bottom: 'auto',
        margin: 0,
      });
    },
    [bounds],
  );
  useEffect(() => {
    if (!enabled) return;
    const update = () => place(position.current);
    update();
    const observer = new ResizeObserver(update);
    if (frame.current) observer.observe(frame.current);
    if (dock.current) observer.observe(dock.current);
    return () => observer.disconnect();
  }, [enabled, minimized, place, frame, dock]);
  const savePosition = useCallback(() => persist({ ...saved.current, position: position.current }), [persist]);
  const resetPosition = useCallback(() => {
    place(origin);
    persist({ ...saved.current, position: origin });
    activity();
  }, [place, persist, activity]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || drag.current) return;
    const room = bounds();
    if (!room) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.current.x * room.x,
      top: position.current.y * room.y,
      initial: { ...position.current },
    };
    setDragging(true);
    activity();
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    const room = bounds();
    if (!start || start.id !== event.pointerId || !room) return;
    event.preventDefault();
    event.stopPropagation();
    place({
      x: room.x ? (start.left + event.clientX - start.x) / room.x : 0.5,
      y: room.y ? (start.top + event.clientY - start.y) / room.y : 1,
    });
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    event.stopPropagation();
    if (event.type === 'pointercancel') place(start.initial);
    else savePosition();
    drag.current = null;
    setDragging(false);
    activity();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') return resetPosition();
    const room = bounds();
    if (!room) return;
    const step = event.shiftKey ? 60 : 20;
    place({
      x:
        position.current.x +
        (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / (room.x || Infinity),
      y:
        position.current.y +
        (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / (room.y || Infinity),
    });
    savePosition();
    activity();
  }
  return {
    mode: preferences.mode,
    minimized,
    dragging,
    setMode,
    restore,
    resetPosition,
    activity,
    positionStyle: enabled ? positionStyle : undefined,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown,
      onClick: (event: MouseEvent<HTMLButtonElement>) => event.currentTarget.focus({ preventScroll: true }),
    },
  };
}
