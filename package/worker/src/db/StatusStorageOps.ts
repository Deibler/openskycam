import type { NewestSegment } from '../models/statusStoragemodel';

export function findNewestSegment(db: D1Database, cam: string): Promise<NewestSegment | null> {
  return db
    .prepare('SELECT object_key, uploaded_at FROM segments WHERE cam = ? ORDER BY uploaded_at DESC LIMIT 1')
    .bind(cam)
    .first<NewestSegment>();
}
