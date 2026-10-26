import type { FrameCrop } from '../models/bucketBrowseInferencemodel';

/**
 * The part of a frame an object thumbnail shows: the frame's shape, 1.6× the box's larger side
 * (at least 1/32 of the frame), centered on the box and kept inside the frame. The website lays a
 * thumbnail it already has over this spot while the original loads.
 */
export function thumbnailCrop(width: number, height: number, box: number[]): FrameCrop {
  const fraction = Math.min(1, Math.max(1 / 32, (box[2] - box[0]) * 1.6, (box[3] - box[1]) * 1.6));
  const w = Math.ceil(width * fraction),
    h = Math.ceil(height * fraction);
  return {
    left: Math.max(0, Math.min(width - w, Math.floor(((box[0] + box[2]) * width) / 2 - w / 2))),
    top: Math.max(0, Math.min(height - h, Math.floor(((box[1] + box[3]) * height) / 2 - h / 2))),
    width: w,
    height: h,
  };
}

/** A kept thumbnail's file under its item: one per mode and size. */
export const thumbnailFile = (mode: 'object' | 'frame', size: number) => `${mode}-${size}.jpg`;
/** Every file an item's kept thumbnails can use, so deleting its bucket can release them all. */
export const thumbnailFiles = (['object', 'frame'] as const).flatMap(mode =>
  [256, 512].map(size => thumbnailFile(mode, size)),
);
export const thumbnailRoot = 'thumbnails/';
export const thumbnailKey = (itemId: string, file: string) => `${thumbnailRoot}${itemId}/${file}`;
