import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoViewport } from '../ui/hooks/use-video-viewport';
import { anchoredZoom, boundPan, videoGeometry, visibleFrame } from '../ui/lib/video-viewport';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function setup() {
  const stage = document.createElement('div');
  const video = document.createElement('video');
  stage.append(video);
  document.body.append(stage);
  stage.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    top: 0,
    right: 600,
    bottom: 400,
    left: 0,
    toJSON() {},
  });
  Object.defineProperties(video, {
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
    setPointerCapture: { value: vi.fn() },
  });
  const videoRef = { current: video };
  const stageRef = { current: stage };
  const tap = vi.fn();
  const hook = renderHook(() => useVideoViewport(videoRef, stageRef, tap));
  return { ...hook, video, stage, tap };
}
function pointer(video: HTMLVideoElement, type: string, pointerId: number, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId, pointerType: 'touch', clientX: x, clientY: y });
  video.dispatchEvent(event);
}
it('pinches with two fingers, continues with one-finger panning, and never toggles playback', () => {
  const { result, video, tap } = setup();
  act(() => {
    pointer(video, 'pointerdown', 1, 200, 200);
    pointer(video, 'pointerdown', 2, 400, 200);
    pointer(video, 'pointermove', 1, 100, 200);
    pointer(video, 'pointermove', 2, 500, 200);
  });
  expect(result.current.zoom).toBe(2);
  expect(result.current.pan).toEqual({ x: 0, y: 0 });
  act(() => {
    pointer(video, 'pointerup', 1, 100, 200);
    pointer(video, 'pointermove', 2, 540, 220);
    pointer(video, 'pointerup', 2, 540, 220);
  });
  expect(result.current.pan).toEqual({ x: 40, y: 20 });
  expect(tap).not.toHaveBeenCalled();
});
it('handles trackpad pinch and scroll inside the video while preserving the image under the pointer', () => {
  const { result, stage } = setup();
  const pinch = new WheelEvent('wheel', {
    ctrlKey: true,
    deltaY: -Math.log(2) * 100,
    clientX: 400,
    clientY: 200,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    stage.dispatchEvent(pinch);
  });
  expect(pinch.defaultPrevented).toBe(true);
  expect(result.current.zoom).toBe(2);
  expect(result.current.pan.x).toBe(-100);
  act(() => {
    stage.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 20, bubbles: true, cancelable: true }));
  });
  expect(result.current.pan).toEqual({ x: -140, y: -20 });
});
it('uses Safari gesture scale from the gesture start without doubling wheel events', () => {
  const { result, stage } = setup();
  const gesture = (type: string, scale: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { scale, clientX: 300, clientY: 200 });
    stage.dispatchEvent(event);
  };
  act(() => {
    gesture('gesturestart', 1);
    gesture('gesturechange', 2);
    gesture('gesturechange', 3);
    stage.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }));
  });
  expect(result.current.zoom).toBe(3);
  act(() => gesture('gestureend', 3));
});
it('keeps the overview box accurate for a letterboxed video and clamps panning to the image', () => {
  const geometry = videoGeometry(600, 400, 1920, 1080);
  const transform = anchoredZoom({ zoom: 1, pan: { x: 0, y: 0 } }, 2, { x: 0, y: 0 }, geometry);
  const frame = visibleFrame(transform, geometry);
  expect(frame.x).toBe(0.25);
  expect(frame.width).toBe(0.5);
  expect(frame.height).toBeCloseTo(400 / 675);
  expect(boundPan({ x: 9999, y: -9999 }, 2, geometry)).toEqual({ x: 300, y: -137.5 });
  expect(visibleFrame({ zoom: 1, pan: { x: 0, y: 0 } }, geometry)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});
it('recenters the enlarged image from a point in the overview and resets to the full frame', () => {
  const { result } = setup();
  act(() => result.current.zoomTo(4));
  act(() => result.current.centerAt(0.75, 0.5));
  expect(result.current.pan.x).toBe(-600);
  expect(visibleFrame(result.current, result.current.geometry).x).toBe(0.625);
  act(() => result.current.reset());
  expect(result.current.zoom).toBe(1);
  expect(result.current.pan).toEqual({ x: 0, y: 0 });
});

it('plays or pauses on a tap while zoomed, tolerating small finger movement without panning', () => {
  const { result, video, tap } = setup();
  act(() => result.current.zoomTo(3));
  act(() => {
    pointer(video, 'pointerdown', 1, 250, 200);
    pointer(video, 'pointermove', 1, 253, 201);
    pointer(video, 'pointerup', 1, 253, 201);
  });
  expect(tap).toHaveBeenCalledOnce();
  expect(result.current.zoom).toBe(3);
  expect(result.current.pan).toEqual({ x: 0, y: 0 });
});

it('never toggles playback after dragging, cancelling, or losing pointer capture', () => {
  const { result, video, tap } = setup();
  act(() => result.current.zoomTo(3));
  act(() => {
    pointer(video, 'pointerdown', 1, 200, 200);
    pointer(video, 'pointermove', 1, 240, 220);
    pointer(video, 'pointerup', 1, 240, 220);
  });
  expect(result.current.pan).toEqual({ x: 40, y: 20 });
  act(() => {
    pointer(video, 'pointerdown', 2, 200, 200);
    pointer(video, 'pointercancel', 2, 200, 200);
    pointer(video, 'pointerup', 2, 200, 200);
  });
  act(() => {
    pointer(video, 'pointerdown', 3, 200, 200);
    pointer(video, 'lostpointercapture', 3, 200, 200);
    pointer(video, 'pointerup', 3, 200, 200);
  });
  expect(tap).not.toHaveBeenCalled();
});
