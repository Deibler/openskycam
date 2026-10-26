import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { Env } from '../models/applicationSharedmodel';
import type { ProcessorApp } from '../models/processorInferencemodel';
import type { CompletedResult, TrackEvent } from '../models/resultInferencemodel';
import { checkLease, enabled, jobFor } from './processorInferenceService';
import { validateResult } from './resultValidationInferenceService';
import { evidenceKey } from '../utils/evidenceInferenceUtil';
import { instant } from '../utils/configInferenceUtil';
import { RETENTION_MS } from '../../../shared/src/utils/layoutStorageUtil';
import { findPipeline } from '../db/PipelineInferenceOps';
import { sourceDuration, commitResult, completedResultKey } from '../db/JobInferenceOps';
import { evidenceExists, writeEvidence, readEvidence } from '../db/EvidenceInferenceOps';
export async function complete(app: ProcessorApp, id: string, body: JsonObject): Promise<CompletedResult> {
  const job = await jobFor(app, id);
  checkLease(job, app, body, job.status === 'completed');
  const serialized = JSON.stringify(body.result);
  if (!serialized) throw new ApplicationError('invalid_data', 'Result required.');
  const hash = await sha256(serialized);
  if (job.status === 'completed') {
    if (job.result_sha256 !== hash)
      throw new ApplicationError('conflict', 'A different result has already been committed.');
    return { job_id: id, status: 'completed', result_sha256: hash };
  }
  const spec = await findPipeline(app.env.CATALOG, job.pipeline_id);
  const source = await sourceDuration(app.env, job);
  if (!spec || !source || !source.duration_s) throw new ApplicationError('conflict', 'Source metadata unavailable.');
  const result = validateResult(body.result, job, spec, source.duration_s);
  const bucket = enabled(app.env);
  for (const t of result.tracks)
    if (t.evidence_sha256 && !(await evidenceExists(bucket, evidenceKey(job, t.evidence_sha256))))
      throw new ApplicationError('invalid_data', 'Upload referenced evidence before submitting the result.');
  const key = `inference/${id}/${job.generation}/${hash}.json`;
  await writeEvidence(bucket, key, serialized, hash, 'application/json', job.expires_at);
  const events: TrackEvent[] = result.tracks.map(t => {
    const start = new Date(Date.parse(job.start) + t.points[0].t * 1000);
    return {
      track_id: t.track_id,
      label: t.label,
      score: t.score,
      start: start.toISOString(),
      end: new Date(Date.parse(job.start) + t.points.at(-1)!.t * 1000).toISOString(),
      expires_at: new Date(start.getTime() + RETENTION_MS).toISOString(),
    };
  });
  if (!(await commitResult(app.env, job, hash, key, result, events, instant())))
    throw new ApplicationError('conflict', 'Lease expired before result commit.');
  return { job_id: id, status: 'completed', result_sha256: hash };
}
export async function readResult(env: Env, id: string): Promise<ReadableStream> {
  const bucket = enabled(env);
  const job = await completedResultKey(env, id, instant());
  const body = job && (await readEvidence(bucket, job.result_key));
  if (!body) throw new ApplicationError('not_found', 'Result not found.');
  return body;
}
