import type { Env } from '../models/applicationSharedmodel';
import type { WorkshopDeletionCounts, WorkshopDeletionKind } from '../models/workshopDeletionInferencemodel';
import { thumbnailFiles, thumbnailRoot } from '../utils/thumbnailInferenceUtil';

// Match immutable run inputs/outputs, including workflows edited since submission.
const affectedRuns = `SELECT r.id FROM workshop_runs r WHERE
  (?='workflow' AND r.workflow_id=?) OR
  (?='bucket' AND (json_extract(r.snapshot_json,'$.input_bucket')=? OR
    EXISTS(SELECT 1 FROM json_each(r.snapshot_json,'$.output_buckets') WHERE value=?)))`;
const currentRevision = 'EXISTS(SELECT 1 FROM workshop_state WHERE id=1 AND revision=?)';

export async function deletionCounts(env: Env, kind: WorkshopDeletionKind, id: string, now: string) {
  return (await env.CATALOG.withSession('first-primary')
    .prepare(`SELECT
    (SELECT COUNT(*) FROM workshop_items WHERE bucket_id=? AND expires_at>?) images,
    (SELECT COUNT(*) FROM workshop_items WHERE bucket_id=? AND expires_at>? AND object_key LIKE 'retained/%') saved_images,
    (SELECT COUNT(*) FROM workshop_versions WHERE bucket_id=?) versions,
    (SELECT COUNT(DISTINCT run_id) FROM workshop_jobs WHERE status IN ('queued','leased') AND expires_at>? AND run_id IN (${affectedRuns})) active_runs
  `)
    .bind(
      kind === 'bucket' ? id : '',
      now,
      kind === 'bucket' ? id : '',
      now,
      kind === 'bucket' ? id : '',
      now,
      kind,
      id,
      kind,
      id,
      id,
    )
    .first<WorkshopDeletionCounts>())!;
}

/** One transaction: fence workers, remove logical data, and advance the document revision. */
export async function deleteEntry(
  env: Env,
  kind: WorkshopDeletionKind,
  id: string,
  revision: number,
  document: string,
  now: string,
  orphanExpiry: string,
) {
  const db = env.CATALOG.withSession('first-primary');
  const statements = [
    db
      .prepare(`UPDATE workshop_jobs SET status='cancelled',error=?
    WHERE status IN ('queued','leased') AND run_id IN (${affectedRuns}) AND ${currentRevision}`)
      .bind(`${kind}_deleted`, kind, id, kind, id, id, revision),
  ];
  if (kind === 'bucket') {
    statements.push(
      // Saved bytes can be shared by downstream buckets. Only release an unreferenced copy.
      // The existing upload journal gives cleanup a retryable grace period; source video is untouched.
      db
        .prepare(`UPDATE workshop_uploads SET expires_at=MIN(expires_at,?)
        WHERE object_key LIKE 'retained/%'
        AND object_key IN (SELECT object_key FROM workshop_items WHERE bucket_id=?)
        AND NOT EXISTS(SELECT 1 FROM workshop_items i WHERE i.object_key=workshop_uploads.object_key AND i.bucket_id!=? AND i.expires_at>?)
        AND ${currentRevision}`)
        .bind(orphanExpiry, id, id, now, revision),
      // Kept thumbnails belong to one item each, so all of the bucket's are released.
      db
        .prepare(`UPDATE workshop_uploads SET expires_at=MIN(expires_at,?)
        WHERE object_key IN (SELECT ?||i.id||'/'||f.value FROM workshop_items i,json_each(?) f WHERE i.bucket_id=?)
        AND ${currentRevision}`)
        .bind(orphanExpiry, thumbnailRoot, JSON.stringify(thumbnailFiles), id, revision),
      db.prepare(`DELETE FROM workshop_versions WHERE bucket_id=? AND ${currentRevision}`).bind(id, revision),
      db
        .prepare(`DELETE FROM workshop_previews WHERE json_extract(item_json,'$.bucket_id')=? AND ${currentRevision}`)
        .bind(id, revision),
      db.prepare(`DELETE FROM workshop_items WHERE bucket_id=? AND ${currentRevision}`).bind(id, revision),
    );
  }
  // Keep this last: all preceding statements use the same revision fence within D1's atomic batch.
  statements.push(
    db
      .prepare('UPDATE workshop_state SET revision=revision+1,document_json=?,updated_at=? WHERE id=1 AND revision=?')
      .bind(document, now, revision),
  );
  const results = await db.batch(statements);
  return results.at(-1)!.meta.changes === 1;
}
