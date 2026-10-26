import { storeUrl } from '../../../shared/src/utils/layoutStorageUtil';
import type { Env } from '../models/applicationSharedmodel';
import type { VideoObject } from '../models/videoStoragemodel';

/**
 * Reads a recording from the footage store (external/store). The store serves one byte range with
 * 206, or answers 416 with the size when the range lies outside the file. Null when nothing is
 * stored at the key; throws when the store fails or leaves out the size.
 */
export async function readVideo(
  env: Env,
  key: string,
  head: boolean,
  range: string | null,
): Promise<VideoObject | null> {
  const headers = new Headers({ Authorization: `Bearer ${env.STORE_TOKEN}` });
  if (range !== null && !head) headers.set('Range', range);
  const response = await env.STORE.fetch(storeUrl(key), {
    method: head ? 'HEAD' : 'GET',
    headers,
  });
  const etag = response.headers.get('ETag');
  const contentRange = response.headers.get('Content-Range') ?? '';
  const length = response.headers.get('Content-Length');
  if (response.status === 200 && length !== null) {
    return { size: Number(length), etag, body: response.body, range: null, invalidRange: false };
  }
  const partial = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  if (response.status === 206 && partial) {
    const [first, last, size] = partial.slice(1).map(Number) as [number, number, number];
    return {
      size,
      etag,
      body: response.body,
      range: { offset: first, length: last - first + 1 },
      invalidRange: false,
    };
  }
  await response.body?.cancel();
  if (response.status === 404) return null;
  if (response.status === 416) {
    const size = Number(contentRange.split('/')[1]);
    return { size, etag: null, body: null, range: null, invalidRange: true };
  }
  throw new Error(`footage store answered ${response.status}`);
}
