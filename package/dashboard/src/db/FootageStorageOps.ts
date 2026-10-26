import type { RecordingRow, Cursor } from '../models/footageStoragemodel';
export async function queryRecordings(
  db: D1Database,
  camera: string,
  from: string,
  to: string,
  asOf: string,
  cursor: Cursor | null,
  limit: number,
): Promise<RecordingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT object_key, cam, start, size, sha256, duration_s, frames, width, height, bitrate, codec FROM segments
    WHERE cam = ? AND start < ? AND strftime('%Y-%m-%dT%H:%M:%fZ', start, '+' || COALESCE(duration_s, 60) || ' seconds') > ? AND uploaded_at <= ?
      AND (start > ? OR (start = ? AND object_key > ?)) ORDER BY start, object_key LIMIT ?`,
    )
    .bind(camera, to, from, asOf, cursor?.start ?? '', cursor?.start ?? '', cursor?.key ?? '', limit + 1)
    .all<RecordingRow>();
  return results;
}
