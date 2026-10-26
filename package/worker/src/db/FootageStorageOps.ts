import { storeUrl } from '../../../shared/src/utils/layoutStorageUtil';
import type { Env } from '../models/applicationSharedmodel';
import type { StoreOutcome, Upload } from '../models/segmentsStoragemodel';

/**
 * Streams a segment to the footage store (external/store), which checks it against X-Sha256 and
 * never replaces a stored file: 201 stored, 200 identical, 409 different bytes, 422 mismatch, and
 * 503/507 while its disk is missing or full.
 */
export async function storeObject(env: Env, upload: Upload, body: ReadableStream | null): Promise<StoreOutcome> {
  const response = await env.STORE.fetch(storeUrl(upload.key), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.STORE_TOKEN}`,
      'X-Sha256': upload.metadata.sha256!,
    },
    body,
  });
  if (response.status === 201 || response.status === 200) {
    const { size } = await response.json<{ size: number }>();
    return { outcome: response.status === 201 ? 'created' : 'already', size };
  }
  await response.body?.cancel();
  if (response.status === 409) return { outcome: 'conflict' };
  if (response.status === 422) return { outcome: 'mismatch' };
  return { outcome: 'refused', status: response.status };
}
