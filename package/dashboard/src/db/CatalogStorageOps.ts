import type { Totals, DaySummary, SegmentRow, NewestSegment, CalendarDayRow } from '../models/catalogStoragemodel';
/** Per-UTC-day totals from `fromDay` (YYYY-MM-DD) onward, oldest first. */
export async function dailySummaries(db: D1Database, cam: string, fromDay: string): Promise<DaySummary[]> {
  const { results } = await db
    .prepare('SELECT day, segments, bytes, seconds FROM daily_stats WHERE cam = ? AND day >= ? ORDER BY day')
    .bind(cam, fromDay)
    .all<DaySummary>();
  return results;
}

/** Totals for segments uploaded at or after `since`. */
export async function totalsUploadedSince(db: D1Database, cam: string, since: Date): Promise<Totals> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS segments, COALESCE(SUM(size), 0) AS bytes, COALESCE(SUM(duration_s), 0) AS seconds
         FROM segments WHERE cam = ? AND uploaded_at >= ?`,
    )
    .bind(cam, since.toISOString())
    .first<Totals>();
  return row ?? { segments: 0, bytes: 0, seconds: 0 };
}

export function newestSegment(db: D1Database, cam: string): Promise<NewestSegment | null> {
  return db
    .prepare('SELECT start, uploaded_at FROM segments WHERE cam = ? ORDER BY uploaded_at DESC LIMIT 1')
    .bind(cam)
    .first<NewestSegment>();
}

/** Segments whose start lies in [from, to), oldest first. */
export async function segmentsBetween(db: D1Database, cam: string, from: Date, to: Date): Promise<SegmentRow[]> {
  const { results } = await db
    .prepare(
      `SELECT start, size, duration_s, frames, width, height, bitrate, codec
         FROM segments WHERE cam = ? AND start >= ? AND start < ? ORDER BY start`,
    )
    .bind(cam, from.toISOString(), to.toISOString())
    .all<SegmentRow>();
  return results;
}

/** One indexed existence lookup per calendar day, using the viewer's actual day boundaries. */
export async function availableDays(db: D1Database, cam: string, boundaries: Date[]): Promise<string[]> {
  const windows = boundaries
    .slice(0, -1)
    .map((from, index) => [from.toISOString(), boundaries[index + 1].toISOString()]);
  const { results } = await db
    .prepare(
      `WITH windows(first, last) AS (VALUES ${windows.map(() => '(?, ?)').join(', ')})
     SELECT first FROM windows WHERE EXISTS (
       SELECT 1 FROM segments WHERE cam = ? AND start >= windows.first AND start < windows.last
     ) ORDER BY first`,
    )
    .bind(...windows.flat(), cam)
    .all<CalendarDayRow>();
  return results.map(row => row.first);
}
