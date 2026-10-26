import type { WorkshopRunImage, WorkshopRecording } from './workshopInferencemodel';

export interface BucketBrowseFilter {
  bucket: string;
  run: string;
  camera: string;
  className: string;
  review: string;
  saved: boolean;
  query: string;
  from: string;
  to: string;
  minConfidence: number;
  maxConfidence: number;
  minObjects: number;
  maxObjects: number;
  oldest: boolean;
  snapshot: string;
  after: { at: string; id: string } | null;
  limit: number;
}
export interface BucketBrowseCursor {
  at: string;
  id: string;
  snapshot: string;
}
export interface BucketBrowseFacets {
  runs: { id: string; name: string; created_at: string; images: number }[];
  cameras: string[];
  classes: string[];
}
export interface BucketBrowsePage {
  items: WorkshopRunImage[];
  total: number;
  cursor: string | null;
  facets: BucketBrowseFacets;
}
export interface BucketItemDetail {
  item: WorkshopRunImage;
  recording: WorkshopRecording | null;
  run: { id: string; name: string; created_at: string };
  classes: { id: number; name: string }[];
}
export interface BucketThumbnail {
  body: ReadableStream<Uint8Array> | ArrayBuffer | null;
  etag: string;
  maxAge: number;
  notModified: boolean;
}
/** A crop of a frame, in frame pixels. */
export interface FrameCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}
