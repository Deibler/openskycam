import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { Env } from '../models/applicationSharedmodel';
import type { ReconcileResult, InferenceStatus } from '../models/processorInferencemodel';
import { requireKnownCamera } from './cameraStorageService';
import { enabled } from './processorInferenceService';
import { subscriptionEnabled } from '../db/PipelineInferenceOps';
import { enqueueWindow, readStatus } from '../db/JobInferenceOps';
import { instant } from '../utils/configInferenceUtil';
import { RETENTION_MS } from '../../../shared/src/utils/layoutStorageUtil';
export async function reconcile(env: Env, body: JsonObject): Promise<ReconcileResult> {
  enabled(env);
  const cam = requireKnownCamera(env, typeof body.camera === 'string' ? body.camera : null);
  const from = typeof body.from === 'string' ? Date.parse(body.from) : NaN;
  const to = typeof body.to === 'string' ? Date.parse(body.to) : NaN;
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > 86400000 ||
    typeof body.pipeline_id !== 'string'
  )
    throw new ApplicationError('invalid_input', 'Choose a pipeline and a time window of at most 24 hours.');
  if (!(await subscriptionEnabled(env.CATALOG, body.pipeline_id, cam)))
    throw new ApplicationError('invalid_input', 'Enable this pipeline for the camera first.');
  return {
    enqueued: await enqueueWindow(env, {
      pipeline: body.pipeline_id,
      cam,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cutoff: new Date(Date.now() - RETENTION_MS).toISOString(),
      now: instant(),
      retentionSeconds: RETENTION_MS / 1000,
      maxJobs: 1440,
    }),
  };
}
export async function status(env: Env): Promise<InferenceStatus> {
  enabled(env);
  return readStatus(env, instant());
}
