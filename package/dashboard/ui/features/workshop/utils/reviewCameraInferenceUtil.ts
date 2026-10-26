import type { Camera, Size } from '../models/reviewInferencemodel';
import type { FrameCrop } from '../../../../src/models/bucketBrowseInferencemodel';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const fitScale = (view: Size, frame: Size) => Math.min(view.width / frame.width, view.height / frame.height);

/** Keeps the frame covering the view along each axis it overflows, and centered along each it does not. */
export function clampCamera(view: Size, frame: Size, camera: Camera): Camera {
  const axis = (offset: number, space: number, length: number) =>
    length <= space ? (space - length) / 2 : clamp(offset, space - length, 0);
  return {
    scale: camera.scale,
    x: axis(camera.x, view.width, frame.width * camera.scale),
    y: axis(camera.y, view.height, frame.height * camera.scale),
  };
}

/**
 * Centers `box` (fractions) with `context` times its size around it, as close as the frame's edges
 * allow. Never smaller than the whole frame fitting the view, nor larger than `max` screen px per frame px.
 * Without a box, the whole frame fits the view.
 */
export function focusCamera(view: Size, frame: Size, box?: number[], context = 4, max = 3): Camera {
  const fit = fitScale(view, frame);
  if (!box) return clampCamera(view, frame, { scale: fit, x: 0, y: 0 });
  const width = Math.max(1, (box[2] - box[0]) * frame.width * context),
    height = Math.max(1, (box[3] - box[1]) * frame.height * context);
  const scale = Math.max(fit, Math.min(max, view.width / width, view.height / height));
  const x = ((box[0] + box[2]) / 2) * frame.width,
    y = ((box[1] + box[3]) / 2) * frame.height;
  return clampCamera(view, frame, { scale, x: view.width / 2 - x * scale, y: view.height / 2 - y * scale });
}

/** Scales by `factor` while the frame point under `at` (view px) stays put. */
export function zoomCamera(
  view: Size,
  frame: Size,
  camera: Camera,
  factor: number,
  at: { x: number; y: number },
  max: number,
): Camera {
  const scale = clamp(camera.scale * factor, fitScale(view, frame), max),
    k = scale / camera.scale;
  return clampCamera(view, frame, { scale, x: at.x - (at.x - camera.x) * k, y: at.y - (at.y - camera.y) * k });
}

/** A box (fractions) in view px. */
export function screenBox(frame: Size, camera: Camera, box: number[]) {
  return {
    left: camera.x + box[0] * frame.width * camera.scale,
    top: camera.y + box[1] * frame.height * camera.scale,
    width: (box[2] - box[0]) * frame.width * camera.scale,
    height: (box[3] - box[1]) * frame.height * camera.scale,
  };
}

/** A view point as a frame fraction, clamped to the frame. */
export function framePoint(frame: Size, camera: Camera, x: number, y: number) {
  return [
    clamp((x - camera.x) / (frame.width * camera.scale), 0, 1),
    clamp((y - camera.y) / (frame.height * camera.scale), 0, 1),
  ];
}

/** One transform places the frame, so moving the camera can animate. */
export const layerStyle = (frame: Size, camera: Camera) => ({
  width: frame.width,
  height: frame.height,
  transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
});
/** Places a crop of the frame (in frame px) on screen where `layerStyle` puts that part of the whole frame. */
export const cropStyle = (crop: FrameCrop, camera: Camera) => ({
  width: crop.width,
  height: crop.height,
  transform: `translate(${camera.x + crop.left * camera.scale}px, ${camera.y + crop.top * camera.scale}px) scale(${camera.scale})`,
});
