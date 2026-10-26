import type { CatalogEntry } from '../models/catalogStoragemodel';
/**
 * Records a stored segment in the D1 catalog the dashboard reads, and prunes this camera's rows that
 * have passed retention. Idempotent: recording the same key twice leaves one row and one count.
 */
export async function recordSegment(db: D1Database, entry: CatalogEntry, retentionCutoff: string): Promise<void> {
  const start = entry.start.toISOString();
  const m = entry.metadata;

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO segments
           (object_key, cam, start, day, size, duration_s, frames, width, height, bitrate, codec, sha256, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.key,
        entry.cam,
        start,
        start.slice(0, 10),
        entry.size,
        numberOrNull(m.duration_s),
        numberOrNull(m.frames),
        numberOrNull(m.width),
        numberOrNull(m.height),
        numberOrNull(m.bitrate),
        m.codec ?? null,
        entry.sha256,
        entry.uploaded.toISOString(),
      ),
    db.prepare('DELETE FROM segments WHERE cam = ? AND start < ?').bind(entry.cam, retentionCutoff),
  ]);
}
function numberOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}
