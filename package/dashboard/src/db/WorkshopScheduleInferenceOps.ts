import type { Env } from '../models/applicationSharedmodel';
import type { WorkshopFinishedRun, WorkshopRuntime, WorkshopScheduleOutcome } from '../models/workshopInferencemodel';

/** Scheduled run IDs start with sched_; the newest one is where incremental input resumes. */
export async function lastScheduledRun(env: Env, workflowId: string) {
  const row = await env.CATALOG.withSession('first-primary')
    .prepare("SELECT MAX(created_at) AS at FROM workshop_runs WHERE workflow_id=? AND id LIKE 'sched\\_%' ESCAPE '\\'")
    .bind(workflowId)
    .first<{ at: string | null }>();
  return row?.at ?? null;
}

/** Newest full run of a workflow that has no unfinished jobs and completed at least one. */
export const finishedRun = (env: Env, workflowId: string, after: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare(
      `SELECT r.id,MAX(j.completed_at) AS finished_at,(SELECT COUNT(*) FROM workshop_items i WHERE i.run_id=r.id) AS images FROM workshop_runs r JOIN workshop_jobs j ON j.run_id=r.id WHERE r.workflow_id=? AND COALESCE(json_extract(r.snapshot_json,'$.mode'),'run')='run' GROUP BY r.id HAVING SUM(j.status IN ('queued','leased'))=0 AND SUM(j.status='completed')>0 AND MAX(j.completed_at)>? ORDER BY finished_at DESC LIMIT 1`,
    )
    .bind(workflowId, after)
    .first<WorkshopFinishedRun>();

/** The newest runtime a processor has actually checked in with. */
export const activeRuntime = (env: Env) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_runtimes WHERE last_seen_at IS NOT NULL ORDER BY created_at DESC LIMIT 1')
    .first<WorkshopRuntime>();

export const outcome = (env: Env, workflowId: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_schedules WHERE workflow_id=?')
    .bind(workflowId)
    .first<WorkshopScheduleOutcome>();

export async function outcomes(env: Env) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM workshop_schedules ORDER BY checked_at DESC LIMIT 100')
      .all<WorkshopScheduleOutcome>()
  ).results;
}

export async function recordOutcome(env: Env, o: WorkshopScheduleOutcome) {
  await env.CATALOG.withSession('first-primary')
    .prepare('INSERT OR REPLACE INTO workshop_schedules VALUES(?,?,?,?,?,?)')
    .bind(o.workflow_id, o.trigger_key, o.status, o.message, o.run_id, o.checked_at)
    .run();
}
