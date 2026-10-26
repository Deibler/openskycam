import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { Env } from '../models/applicationSharedmodel';
import type { ProcessorApp, Job } from '../models/processorInferencemodel';

import { requireApiCamera } from './credentialSharedService';
import * as ops from '../db/JobInferenceOps';
import { findPipeline } from '../db/PipelineInferenceOps';
import { LEASE_MS, MAX_ATTEMPTS, instant } from '../utils/configInferenceUtil';
import type { ClaimResult, LeaseResult, JobState } from '../models/processorInferencemodel';
export function enabled(env: Env): R2Bucket {
  if (env.INFERENCE_ENABLED !== 'true' || !env.EVIDENCE)
    throw new ApplicationError('not_found', 'Inference is not enabled.');
  return env.EVIDENCE;
}
function authorize(app: ProcessorApp): string {
  enabled(app.env);
  if (app.principal.scope !== 'processor:run' || !app.principal.pipeline_id)
    throw new ApplicationError('forbidden', 'A processor key is required.');
  return app.principal.pipeline_id;
}
export async function jobFor(app: ProcessorApp, id: string): Promise<Job> {
  const pipeline = authorize(app);
  const job = await ops.findJob(app.env, id, pipeline);
  if (!job) throw new ApplicationError('not_found', 'Job not found.');
  requireApiCamera(app.principal, job.cam);
  return job;
}
export function checkLease(job: Job, app: ProcessorApp, body: JsonObject, completedRetry = false) {
  if (
    job.lease_owner !== app.principal.id ||
    job.lease_token !== body.lease_token ||
    job.generation !== body.generation ||
    job.expires_at <= instant() ||
    (!completedRetry && (job.status !== 'leased' || job.lease_until <= instant()))
  ) {
    throw new ApplicationError('conflict', 'The lease is no longer valid. Discard this attempt.');
  }
}
export async function claim(app: ProcessorApp, body: JsonObject): Promise<ClaimResult> {
  const pipeline = authorize(app);
  const cam = requireApiCamera(app.principal, typeof body.camera === 'string' ? body.camera : null);
  const job = await ops.claimJob(
    app.env,
    pipeline,
    cam,
    app.principal.id,
    crypto.randomUUID(),
    instant(),
    new Date(Date.now() + LEASE_MS).toISOString(),
    MAX_ATTEMPTS,
  );
  if (!job) return { job: null };
  const spec = await findPipeline(app.env.CATALOG, pipeline);
  const input = await ops.findInput(app.env, job);
  if (!input || !spec) throw new ApplicationError('conflict', 'Source or pipeline is no longer available.');
  return {
    job: {
      id: job.id,
      generation: job.generation,
      lease_token: job.lease_token,
      lease_until: job.lease_until,
      expires_at: job.expires_at,
      input,
      pipeline: {
        id: spec.id,
        model_sha256: spec.model_sha256,
        code_sha256: spec.code_sha256,
        config_sha256: spec.config_sha256,
        config: JSON.parse(spec.config_json),
      },
    },
  };
}
export async function heartbeat(app: ProcessorApp, id: string, body: JsonObject): Promise<LeaseResult> {
  const job = await jobFor(app, id);
  checkLease(job, app, body);
  const until = new Date(Math.min(Date.now() + LEASE_MS, Date.parse(job.expires_at))).toISOString();
  if (!(await ops.renewLease(app.env, job, until, instant()))) throw new ApplicationError('conflict', 'Lease expired.');
  return { lease_until: until };
}
export async function fail(app: ProcessorApp, id: string, body: JsonObject): Promise<JobState> {
  const job = await jobFor(app, id);
  checkLease(job, app, body);
  // Bounded codes keep secrets, paths and exception dumps out of the catalog.
  if (
    ![
      'download_failed',
      'checksum_mismatch',
      'decode_failed',
      'model_failed',
      'source_missing',
      'processor_failed',
    ].includes(String(body.error))
  )
    throw new ApplicationError('invalid_input', 'Provide a supported error code.');
  const changed = await ops.failJob(
    app.env,
    job,
    String(body.error),
    body.error === 'source_missing',
    MAX_ATTEMPTS,
    new Date(Date.now() + 60_000).toISOString(),
    instant(),
  );
  if (!changed) throw new ApplicationError('conflict', 'Lease expired.');
  return changed;
}
