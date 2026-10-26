/** Read-only queries against the D1 catalog the ingest Worker writes (schema: db/migrations). */

export interface Totals {
  segments: number;
  bytes: number;
  seconds: number;
}

export interface DaySummary extends Totals {
  day: string;
}

export interface SegmentRow {
  start: string;
  size: number;
  duration_s: number | null;
  frames: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  codec: string | null;
}

export interface NewestSegment {
  start: string;
  uploaded_at: string;
}
export interface CalendarDayRow {
  first: string;
}
