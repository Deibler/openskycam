export interface VideoQuery {
  camera: string;
  start: string;
  range: string | null;
  head: boolean;
}
export interface ByteRange {
  offset: number;
  length: number;
}
/** A recording read from the footage store. */
export interface VideoObject {
  /** The whole file's size in bytes. */
  size: number;
  etag: string | null;
  body: ReadableStream | null;
  /** The part of the file in body; null when body is the whole file. */
  range: ByteRange | null;
  /** The requested range lies outside the file; body is null. */
  invalidRange: boolean;
}
export interface VideoStream extends VideoObject {
  filename: string;
}
