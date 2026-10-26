/**
 * Metadata recorded in the catalog for every segment: start (ISO 8601 UTC), sha256, and the relay's
 * ffprobe measurements when sent (duration_s, frames, width, height, bitrate, codec).
 */
export type SegmentMetadata = Record<string, string>;
export interface Upload {
  cam: string;
  start: Date;
  key: string;
  metadata: SegmentMetadata;
}
export interface UploadInput {
  camera: string;
  start: string;
  body: ReadableStream | null;
  contentLength: string | null;
  contentType: string | null;
  sha256: string | null;
  codec: string | null;
  measurements: Record<string, string>;
}
export interface AlreadyStored {
  key: string;
  stored: 'already';
}
export interface NewlyStored {
  key: string;
  size: number;
}
export type UploadResult = AlreadyStored | NewlyStored;
/** What the footage store did with an upload; `refused` carries its HTTP status for the log. */
export type StoreOutcome =
  | { outcome: 'created' | 'already'; size: number }
  | { outcome: 'conflict' | 'mismatch' }
  | { outcome: 'refused'; status: number };
