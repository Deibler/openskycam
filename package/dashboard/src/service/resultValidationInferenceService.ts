import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { hashPattern } from '../utils/configInferenceUtil';
import type { Job, Pipeline } from '../models/processorInferencemodel';
import type { Result } from '../models/resultInferencemodel';
const numberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validateResult(value: unknown, job: Job, spec: Pipeline, duration: number): Result {
  const r = value as Result;
  const p = r?.provenance;
  const m = r?.metrics;
  if (
    !p ||
    p.input_sha256 !== job.input_sha256 ||
    p.model_sha256 !== spec.model_sha256 ||
    p.code_sha256 !== spec.code_sha256 ||
    p.config_sha256 !== spec.config_sha256 ||
    !p.runtime ||
    typeof p.runtime !== 'object'
  )
    throw new ApplicationError('invalid_data', 'Provenance does not match this job.');
  if (
    !m ||
    !numberIn(m.processed_seconds, Math.max(0.01, duration - 2), duration + 2) ||
    !numberIn(m.elapsed_seconds, 0.001, 86400) ||
    !Number.isSafeInteger(m.sampled_frames) ||
    m.sampled_frames < 1 ||
    !Number.isSafeInteger(m.decoded_frames) ||
    m.decoded_frames < m.sampled_frames
  )
    throw new ApplicationError(
      'invalid_data',
      'A complete decoded recording and valid processing metrics are required.',
    );
  if (!Array.isArray(r.tracks) || r.tracks.length > 256)
    throw new ApplicationError('invalid_data', 'Provide up to 256 tracks.');
  const ids = new Set<number>();
  for (const t of r.tracks) {
    if (
      !t ||
      !Number.isSafeInteger(t.track_id) ||
      t.track_id < 1 ||
      ids.has(t.track_id) ||
      !['plane', 'wildlife', 'meteor', 'unresolved'].includes(t.label) ||
      !numberIn(t.score, 0, 1) ||
      !Array.isArray(t.points) ||
      t.points.length < 2 ||
      t.points.length > 4000 ||
      (t.evidence_sha256 !== undefined && !hashPattern.test(t.evidence_sha256))
    )
      throw new ApplicationError('invalid_data', 'Invalid track summary.');
    ids.add(t.track_id);
    let last = -1;
    for (const point of t.points) {
      if (
        !point ||
        !numberIn(point.t, 0, duration + 1) ||
        point.t <= last ||
        !numberIn(point.score, 0, 1) ||
        !Array.isArray(point.box) ||
        point.box.length !== 4 ||
        point.box.some(n => !numberIn(n, 0, 1)) ||
        point.box[0] >= point.box[2] ||
        point.box[1] >= point.box[3]
      )
        throw new ApplicationError('invalid_data', 'Invalid timestamped track point.');
      last = point.t;
    }
  }
  return r;
}
