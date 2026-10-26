import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { ProcessorApp } from '../models/processorInferencemodel';
import type { EvidenceResult } from '../models/resultInferencemodel';
import { jobFor, checkLease, enabled } from './processorInferenceService';
import { evidenceKey } from '../utils/evidenceInferenceUtil';
import { hashPattern } from '../utils/configInferenceUtil';
import { writeEvidence } from '../db/EvidenceInferenceOps';
export async function evidence(
  app: ProcessorApp,
  id: string,
  hash: string,
  lease: JsonObject,
  contentType: string | null,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<EvidenceResult> {
  const job = await jobFor(app, id);
  checkLease(job, app, lease);
  if (!hashPattern.test(hash) || contentType !== 'image/jpeg')
    throw new ApplicationError('invalid_input', 'Send a JPEG using its SHA-256 as the filename.');
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || (await sha256(bytes.buffer)) !== hash)
    throw new ApplicationError('invalid_data', 'Evidence checksum or JPEG header mismatch.');
  await writeEvidence(enabled(app.env), evidenceKey(job, hash), bytes, hash, 'image/jpeg', job.expires_at);
  return { sha256: hash };
}
