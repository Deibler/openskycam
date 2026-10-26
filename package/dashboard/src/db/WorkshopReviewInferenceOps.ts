import type { Env } from '../models/applicationSharedmodel';
import type { WorkshopClassStat, WorkshopDailyStat, WorkshopItem, WorkshopJob } from '../models/workshopInferencemodel';

const read = (env: Env) => env.CATALOG.withSession('first-primary');
/** Sighting counts and review outcomes per workflow, over images that have not expired. */
export async function workflowItems(env: Env, now: string) {
  return (
    await read(env)
      .prepare(
        "SELECT r.workflow_id,COUNT(*) images,SUM(i.review='accepted') accepted,SUM(i.review='rejected') rejected,SUM(i.review='pending') pending FROM workshop_items i JOIN workshop_runs r ON r.id=i.run_id WHERE i.expires_at>? GROUP BY r.workflow_id",
      )
      .bind(now)
      .all<{ workflow_id: string; images: number; accepted: number; rejected: number; pending: number }>()
  ).results;
}
export async function workflowRuns(env: Env, hiddenWorkflow: string) {
  return (
    await read(env)
      .prepare('SELECT workflow_id,COUNT(*) runs FROM workshop_runs WHERE workflow_id<>? GROUP BY workflow_id')
      .bind(hiddenWorkflow)
      .all<{ workflow_id: string; runs: number }>()
  ).results;
}
/** Per class: how many predictions, on how many images, and how many of those images a reviewer accepted or rejected. */
export async function classStats(env: Env, now: string) {
  return (
    await read(env)
      .prepare(
        "SELECT r.workflow_id,json_extract(a.value,'$.class_name') class_name,COUNT(*) detections,COUNT(DISTINCT i.id) images,COUNT(DISTINCT CASE WHEN i.review='accepted' THEN i.id END) accepted,COUNT(DISTINCT CASE WHEN i.review='rejected' THEN i.id END) rejected FROM workshop_items i JOIN workshop_runs r ON r.id=i.run_id,json_each(i.annotation_json) a WHERE i.expires_at>? GROUP BY 1,2 ORDER BY detections DESC",
      )
      .bind(now)
      .all<WorkshopClassStat>()
  ).results;
}
export async function dailyStats(env: Env, now: string) {
  return (
    await read(env)
      .prepare(
        'SELECT r.workflow_id,substr(i.captured_at,1,10) day,COUNT(*) images FROM workshop_items i JOIN workshop_runs r ON r.id=i.run_id WHERE i.expires_at>? GROUP BY 1,2 ORDER BY 2',
      )
      .bind(now)
      .all<WorkshopDailyStat>()
  ).results;
}
/** A run's sighting frames in capture order. */
export async function runItems(env: Env, run: string, now: string, limit: number) {
  return (
    await read(env)
      .prepare('SELECT * FROM workshop_items WHERE run_id=? AND expires_at>? ORDER BY captured_at,id LIMIT ?')
      .bind(run, now, limit)
      .all<WorkshopItem>()
  ).results;
}
export async function runInputs(env: Env, run: string) {
  return (
    await read(env)
      .prepare('SELECT input_json FROM workshop_jobs WHERE run_id=? ORDER BY LENGTH(id),id')
      .bind(run)
      .all<Pick<WorkshopJob, 'input_json'>>()
  ).results;
}
