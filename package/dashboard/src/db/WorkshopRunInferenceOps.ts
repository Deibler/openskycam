import type { Env } from '../models/applicationSharedmodel';
import type { WorkshopJob, WorkshopItem, WorkshopProgress, WorkshopPreviewRow } from '../models/workshopInferencemodel';

export async function jobs(env: Env, run: string) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM workshop_jobs WHERE run_id=? ORDER BY LENGTH(id),id')
      .bind(run)
      .all<WorkshopJob>()
  ).results;
}
export async function previews(env: Env, run: string, now: string, limit: number) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT p.item_json FROM workshop_previews p JOIN workshop_jobs j ON j.id=p.job_id AND j.generation=p.generation WHERE j.run_id=? AND p.expires_at>? ORDER BY json_extract(p.item_json,'$.created_at') DESC,p.sequence DESC LIMIT ?`,
      )
      .bind(run, now, limit)
      .all<WorkshopPreviewRow>()
  ).results;
}
export const preview = (env: Env, run: string, item: string, now: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare(
      `SELECT p.item_json FROM workshop_previews p JOIN workshop_jobs j ON j.id=p.job_id AND j.generation=p.generation WHERE j.run_id=? AND p.item_id=? AND p.expires_at>? LIMIT 1`,
    )
    .bind(run, item, now)
    .first<WorkshopPreviewRow>();
export async function results(env: Env, run: string, now: string, limit: number) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM workshop_items WHERE run_id=? AND expires_at>? ORDER BY created_at DESC,id LIMIT ?')
      .bind(run, now, limit)
      .all<WorkshopItem>()
  ).results;
}
/** Both the progress event and its preview are fenced by the active attempt. */
export async function progress(
  env: Env,
  j: WorkshopJob,
  value: WorkshopProgress,
  item: WorkshopItem | null,
  sequence: number,
  now: string,
) {
  const db = env.CATALOG.withSession('first-primary');
  const serialized = JSON.stringify(value);
  const statements = [
    db
      .prepare(
        `UPDATE workshop_jobs SET progress_json=? WHERE id=? AND status='leased' AND generation=? AND lease_token=? AND lease_until>? AND expires_at>? AND COALESCE(json_extract(progress_json,'$.processed'),0)<=?`,
      )
      .bind(serialized, j.id, j.generation, j.lease_token, now, now, value.processed),
  ];
  if (item)
    statements.push(
      db
        .prepare(
          `INSERT INTO workshop_previews SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workshop_jobs WHERE id=? AND status='leased' AND generation=? AND lease_token=? AND lease_until>? AND expires_at>? AND progress_json=?) ON CONFLICT(job_id,generation,sequence) DO UPDATE SET item_json=excluded.item_json WHERE workshop_previews.item_id=excluded.item_id`,
        )
        .bind(
          j.id,
          j.generation,
          sequence,
          item.id,
          JSON.stringify(item),
          item.expires_at,
          j.id,
          j.generation,
          j.lease_token,
          now,
          now,
          serialized,
        ),
    );
  const result = await db.batch(statements);
  return result.every(r => r.meta.changes === 1);
}
