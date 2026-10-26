import type { ReconcileWindow } from '../models/processorInferencemodel';
import type { Env } from '../models/applicationSharedmodel';
import type {
  Job,
  JobInput,
  JobState,
  SourceDuration,
  ResultKey,
  JobCount,
  RecentJob,
  InferenceStatus,
} from '../models/processorInferencemodel';
import type { Result, TrackEvent } from '../models/resultInferencemodel';
const dbFor = (env: Env) => env.CATALOG.withSession('first-primary');
export function findJob(env: Env, id: string, pipeline: string): Promise<Job | null> {
  return dbFor(env)
    .prepare('SELECT * FROM inference_jobs WHERE id = ? AND pipeline_id = ?')
    .bind(id, pipeline)
    .first<Job>();
}
export async function claimJob(
  env: Env,
  pipeline: string,
  cam: string,
  owner: string,
  token: string,
  now: string,
  until: string,
  maxAttempts: number,
): Promise<Job | null> {
  const db = dbFor(env);
  await db.batch([
    db
      .prepare(
        `UPDATE inference_jobs SET status = 'expired', error = 'Source recording expired or left the catalog.'
      WHERE pipeline_id = ? AND cam = ? AND status IN ('queued','leased') AND
      (expires_at <= ? OR NOT EXISTS (SELECT 1 FROM segments s WHERE s.object_key = inference_jobs.object_key AND s.sha256 = inference_jobs.input_sha256))`,
      )
      .bind(pipeline, cam, now),
    db
      .prepare(
        `UPDATE inference_jobs SET status = 'failed', error = 'Lease retry limit reached.'
      WHERE pipeline_id = ? AND cam = ? AND status = 'leased' AND lease_until <= ? AND attempts >= ?`,
      )
      .bind(pipeline, cam, now, maxAttempts),
  ]);
  const job = await db
    .prepare(
      `UPDATE inference_jobs SET status = 'leased', attempts = attempts + 1,
    generation = generation + 1, lease_token = ?, lease_owner = ?, lease_until = ?, error = NULL
    WHERE id = (SELECT j.id FROM inference_jobs j JOIN inference_subscriptions sub ON sub.pipeline_id = j.pipeline_id AND sub.cam = j.cam
      WHERE j.pipeline_id = ? AND j.cam = ? AND sub.enabled = 1 AND j.expires_at > ? AND j.attempts < ? AND
      ((j.status = 'queued' AND j.available_at <= ?) OR (j.status = 'leased' AND j.lease_until <= ?))
      ORDER BY j.start, j.id LIMIT 1) RETURNING *`,
    )
    .bind(token, owner, until, pipeline, cam, now, maxAttempts, now, now)
    .first<Job>();

  return job;
}

export function findInput(env: Env, job: Job): Promise<JobInput | null> {
  return dbFor(env)
    .prepare(
      'SELECT object_key, cam, start, size, sha256, duration_s, frames, width, height, codec FROM segments WHERE object_key = ? AND sha256 = ?',
    )
    .bind(job.object_key, job.input_sha256)
    .first<JobInput>();
}
export function sourceDuration(env: Env, job: Job): Promise<SourceDuration | null> {
  return dbFor(env)
    .prepare('SELECT duration_s FROM segments WHERE object_key = ? AND sha256 = ?')
    .bind(job.object_key, job.input_sha256)
    .first<SourceDuration>();
}
export async function renewLease(env: Env, job: Job, until: string, now: string): Promise<boolean> {
  const db = dbFor(env);
  const changed = await db
    .prepare(
      `UPDATE inference_jobs SET lease_until = ? WHERE id = ? AND status = 'leased' AND generation = ? AND lease_token = ? AND lease_until > ? RETURNING id`,
    )
    .bind(until, job.id, job.generation, job.lease_token, now)
    .first();

  return Boolean(changed);
}

export async function failJob(
  env: Env,
  job: Job,
  error: string,
  missing: boolean,
  maxAttempts: number,
  availableAt: string,
  now: string,
): Promise<JobState | null> {
  const db = dbFor(env);
  const changed = await db
    .prepare(
      `UPDATE inference_jobs SET status = CASE WHEN ? THEN 'expired' WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
    error = ?, available_at = ?, lease_until = NULL WHERE id = ? AND status = 'leased' AND generation = ? AND lease_token = ? AND lease_until > ? RETURNING status`,
    )
    .bind(missing ? 1 : 0, maxAttempts, error, availableAt, job.id, job.generation, job.lease_token, now)
    .first<JobState>();

  return changed;
}

/** Commit summary and event rows atomically, fenced to the active lease generation. */
export async function commitResult(
  env: Env,
  job: Job,
  hash: string,
  key: string,
  result: Result,
  events: TrackEvent[],
  now: string,
): Promise<boolean> {
  const db = dbFor(env);
  const updates = await db.batch([
    db
      .prepare(
        `UPDATE inference_jobs SET status = 'completed', completed_at = ?, result_sha256 = ?, result_key = ?, processed_seconds = ?, sampled_frames = ?, elapsed_seconds = ?
      WHERE id = ? AND status = 'leased' AND generation = ? AND lease_token = ? AND lease_until > ? AND expires_at > ? RETURNING id`,
      )
      .bind(
        now,
        hash,
        key,
        result.metrics.processed_seconds,
        result.metrics.sampled_frames,
        result.metrics.elapsed_seconds,
        job.id,
        job.generation,
        job.lease_token,
        now,
        now,
      ),
    // JSON table expansion stays within D1's statement/bind limits, even for hundreds of tracks.
    db
      .prepare(
        `INSERT OR IGNORE INTO inference_events (job_id, track_id, cam, start, end, label, score, expires_at)
      SELECT j.id, json_extract(t.value,'$.track_id'), j.cam, json_extract(t.value,'$.start'), json_extract(t.value,'$.end'),
        json_extract(t.value,'$.label'), json_extract(t.value,'$.score'), json_extract(t.value,'$.expires_at')
      FROM inference_jobs j, json_each(?) t WHERE j.id = ? AND j.status = 'completed' AND j.generation = ? AND j.result_sha256 = ?`,
      )
      .bind(JSON.stringify(events), job.id, job.generation, hash),
  ]);

  return updates[0].results.length > 0;
}

export async function enqueueWindow(env: Env, window: ReconcileWindow): Promise<number> {
  const { pipeline, cam, from, to, cutoff, now, retentionSeconds, maxJobs } = window;
  const db = dbFor(env);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO inference_jobs (pipeline_id, object_key, cam, start, input_sha256, expires_at, available_at, created_at)
    SELECT ?, object_key, cam, start, sha256, strftime('%Y-%m-%dT%H:%M:%fZ', start, ?), ?, ? FROM segments
    WHERE cam = ? AND start >= ? AND start < ? AND start > ? ORDER BY start LIMIT ?`,
    )
    .bind(pipeline, `+${retentionSeconds} seconds`, now, now, cam, from, to, cutoff, maxJobs)
    .run();

  return result.meta.changes;
}

export async function readStatus(env: Env, now: string): Promise<InferenceStatus> {
  const db = dbFor(env);
  const counts = await db
    .prepare(
      `SELECT pipeline_id, cam, status, COUNT(*) AS jobs, SUM(processed_seconds) AS processed_seconds FROM inference_jobs WHERE expires_at > ? GROUP BY pipeline_id, cam, status`,
    )
    .bind(now)
    .all<JobCount>();
  const recent = await db
    .prepare(
      `SELECT id, pipeline_id, cam, start, status, attempts, error, completed_at, result_sha256, processed_seconds, sampled_frames, elapsed_seconds FROM inference_jobs WHERE expires_at > ? ORDER BY created_at DESC, id DESC LIMIT 20`,
    )
    .bind(now)
    .all<RecentJob>();
  return { counts: counts.results, recent: recent.results };
}
export function completedResultKey(env: Env, id: string, now: string): Promise<ResultKey | null> {
  return dbFor(env)
    .prepare(`SELECT result_key FROM inference_jobs WHERE id = ? AND status = 'completed' AND expires_at > ?`)
    .bind(id, now)
    .first<ResultKey>();
}
