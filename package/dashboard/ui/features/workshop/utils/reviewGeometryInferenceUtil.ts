import type { ImageBounds, ImageGeometry, BoxHandle } from '../models/reviewInferencemodel';
import type { WorkshopItem } from '../../../../src/models/workshopInferencemodel';

export function imageGeometry(item: WorkshopItem): ImageGeometry {
  const provenance = JSON.parse(item.provenance_json);
  return {
    width: provenance.width || 1920,
    height: provenance.height || 1080,
    annotations: JSON.parse(item.annotation_json),
  };
}
/** Keep real box coordinates. The focus view adds `context` times the box and clamps at image edges. */
export function objectView(width: number, height: number, box?: number[], context = 4): ImageBounds {
  if (!box) return { x: 0, y: 0, width, height };
  const fraction = Math.min(1, Math.max(1 / 32, (box[2] - box[0]) * context, (box[3] - box[1]) * context));
  const w = width * fraction,
    h = height * fraction;
  return {
    x: Math.max(0, Math.min(width - w, ((box[0] + box[2]) * width) / 2 - w / 2)),
    y: Math.max(0, Math.min(height - h, ((box[1] + box[3]) * height) / 2 - h / 2)),
    width: w,
    height: h,
  };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
/**
 * `box` with one handle dragged by (dx, dy) fractions, or all of it for `move`. It stays inside the
 * frame and at least `min` (fractions) wide and tall. Always derived from the box at drag start, so
 * repeated moves never drift.
 */
export function dragBox(box: number[], handle: BoxHandle, dx: number, dy: number, min: [number, number]): number[] {
  let [left, top, right, bottom] = box;
  if (handle === 'move') {
    const x = clamp(dx, -left, 1 - right),
      y = clamp(dy, -top, 1 - bottom);
    return [left + x, top + y, right + x, bottom + y];
  }
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min[0]);
  if (handle.includes('e')) right = clamp(right + dx, left + min[0], 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min[1]);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min[1], 1);
  return [left, top, right, bottom];
}
/** The box two corner points span, in any order. */
export const spanBox = (a: number[], b: number[]) => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
];
/** The smallest box holding every box, or undefined for none. */
export function unionBox(boxes: (number[] | undefined)[]) {
  const present = boxes.filter((box): box is number[] => !!box);
  if (!present.length) return undefined;
  return [
    Math.min(...present.map(b => b[0])),
    Math.min(...present.map(b => b[1])),
    Math.max(...present.map(b => b[2])),
    Math.max(...present.map(b => b[3])),
  ];
}
