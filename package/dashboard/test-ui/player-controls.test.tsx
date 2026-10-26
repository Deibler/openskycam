import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { KeyboardEvent, PointerEvent } from 'react';
import { CONTROLS_IDLE_MS, usePlayerControls } from '../ui/hooks/use-player-controls';

const storage = new Map<string, string>();
const resizeCallbacks: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-22T20:00:00Z'));
  storage.clear();
  resizeCallbacks.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(
  initial: Partial<{ enabled: boolean; zoom: number; playing: boolean; ready: boolean; blocked: boolean }> = {},
) {
  let width = 500;
  const viewer = document.createElement('section');
  const dock = document.createElement('div');
  const handle = document.createElement('button');
  viewer.append(dock);
  dock.append(handle);
  document.body.append(viewer);
  viewer.getBoundingClientRect = () => ({ width, height: 300, top: 0, left: 0 }) as DOMRect;
  dock.getBoundingClientRect = () => ({ width: Math.min(320, width - 24), height: 64, top: 0, left: 0 }) as DOMRect;
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const viewerRef = { current: viewer };
  const dockRef = { current: dock };
  const props = { enabled: true, zoom: 1, playing: true, ready: true, blocked: false, ...initial };
  const hook = renderHook((state: typeof props) => usePlayerControls({ frame: viewerRef, dock: dockRef, ...state }), {
    initialProps: props,
  });
  const event = (type: string, x: number, y: number) =>
    ({
      type,
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
      currentTarget: handle,
      preventDefault() {},
      stopPropagation() {},
    }) as PointerEvent<HTMLButtonElement>;
  return {
    ...hook,
    props,
    dock,
    event,
    resize: (next: number) => {
      width = next;
      resizeCallbacks.forEach(callback => callback());
    },
  };
}
it('minimizes after playback inactivity and starts a fresh delay after recent interaction', () => {
  const { result } = setup();
  act(() => vi.advanceTimersByTime(CONTROLS_IDLE_MS - 100));
  act(() => result.current.activity());
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.minimized).toBe(false);
  act(() => vi.advanceTimersByTime(CONTROLS_IDLE_MS));
  expect(result.current.minimized).toBe(true);
  act(() => result.current.restore());
  expect(result.current.minimized).toBe(false);
});
it('does not hide paused playback, open menus, or focused time entry', () => {
  const { result, props, rerender, dock } = setup({ playing: false });
  act(() => vi.advanceTimersByTime(20000));
  expect(result.current.minimized).toBe(false);
  rerender({ ...props, playing: true, blocked: true });
  act(() => vi.advanceTimersByTime(20000));
  expect(result.current.minimized).toBe(false);
  rerender({ ...props, playing: true });
  const input = document.createElement('input');
  dock.append(input);
  input.focus();
  act(() => vi.advanceTimersByTime(20000));
  expect(result.current.minimized).toBe(false);
  input.blur();
  act(() => vi.advanceTimersByTime(CONTROLS_IDLE_MS));
  expect(result.current.minimized).toBe(true);
});
it('parks controls after zoom settles and respects an explicit restore while zoomed', () => {
  const { result, props, rerender } = setup({ playing: false });
  rerender({ ...props, zoom: 2 });
  act(() => vi.advanceTimersByTime(200));
  expect(result.current.minimized).toBe(false);
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.minimized).toBe(true);
  act(() => result.current.restore());
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.minimized).toBe(false);
  rerender({ ...props, zoom: 3 });
  act(() => vi.advanceTimersByTime(300));
  expect(result.current.minimized).toBe(true);
});
it('persists manual minimizing and restores the prior always-visible preference', () => {
  const first = setup();
  act(() => first.result.current.setMode('visible'));
  act(() => vi.advanceTimersByTime(20000));
  expect(first.result.current.minimized).toBe(false);
  act(() => first.result.current.setMode('minimized'));
  first.unmount();
  const second = setup();
  expect(second.result.current.minimized).toBe(true);
  act(() => second.result.current.restore());
  expect(second.result.current.mode).toBe('visible');
  act(() => vi.advanceTimersByTime(20000));
  expect(second.result.current.minimized).toBe(false);
});
it('keeps dragging inside the video, persists the chosen position, and clamps on resize', () => {
  const { result, event, resize } = setup();
  expect(result.current.positionStyle).toMatchObject({ left: 90, top: 224 });
  act(() => result.current.handleProps.onPointerDown(event('pointerdown', 100, 250)));
  act(() => result.current.handleProps.onPointerMove(event('pointermove', 9999, -9999)));
  expect(result.current.positionStyle).toMatchObject({ left: 168, top: 24 });
  act(() => vi.advanceTimersByTime(20000));
  expect(result.current.minimized).toBe(false);
  act(() => result.current.handleProps.onPointerUp(event('pointerup', 9999, -9999)));
  expect(JSON.parse(storage.get('skyvision-player-controls')!).position).toEqual({ x: 1, y: 0 });
  act(() => resize(280));
  expect(result.current.positionStyle).toMatchObject({ left: 12, top: 24 });
});
it('cancels an interrupted drag and supports keyboard movement and reset', () => {
  const { result, event } = setup();
  act(() => result.current.handleProps.onPointerDown(event('pointerdown', 100, 250)));
  act(() => result.current.handleProps.onPointerMove(event('pointermove', 170, 100)));
  act(() => result.current.handleProps.onPointerCancel(event('pointercancel', 170, 100)));
  expect(result.current.positionStyle).toMatchObject({ left: 90, top: 224 });
  const key = (value: string) =>
    ({ key: value, shiftKey: false, preventDefault() {}, stopPropagation() {} }) as KeyboardEvent<HTMLButtonElement>;
  act(() => result.current.handleProps.onKeyDown(key('ArrowUp')));
  expect(result.current.positionStyle).toMatchObject({ left: 90, top: 204 });
  act(() => result.current.handleProps.onKeyDown(key('Home')));
  expect(result.current.positionStyle).toMatchObject({ left: 90, top: 224 });
});
it('leaves non-floating desktop controls visible', () => {
  const { result, props, rerender } = setup({ enabled: false, zoom: 3 });
  act(() => result.current.setMode('minimized'));
  act(() => vi.advanceTimersByTime(20000));
  expect(result.current.minimized).toBe(false);
  expect(result.current.positionStyle).toBeUndefined();
  rerender({ ...props, enabled: true });
  expect(result.current.minimized).toBe(true);
});
