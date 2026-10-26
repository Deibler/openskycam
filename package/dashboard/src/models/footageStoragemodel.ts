export interface RecordingRow {
  object_key: string;
  cam: string;
  start: string;
  size: number;
  sha256: string;
  duration_s: number | null;
  frames: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  codec: string | null;
}

export interface Cursor {
  v: 1;
  camera: string;
  from: string;
  to: string;
  as_of: string;
  start: string;
  key: string;
}
export interface FootageQuery {
  camera: string | null;
  from: string | null;
  to: string | null;
  limit: string | null;
  cursor: string | null;
}
export interface FootagePage {
  camera: string;
  from: string;
  to: string;
  as_of: string;
  recordings: RecordingRow[];
  next_cursor: string | null;
}
