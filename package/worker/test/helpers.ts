import { env, exports } from 'cloudflare:workers';
import { compactTimestamp, storeUrl } from '../../shared/src/utils/layoutStorageUtil';

export const TOKEN = 'test-token';
export const CAM = 'sky01';
const BASE_URL = 'https://ingest.test';

/** The headers the relay sends with every segment, measured with ffprobe. */
const RELAY_MEASUREMENTS = {
  'X-Duration': '60.0',
  'X-Frames': '1800',
  'X-Codec': 'hevc',
  'X-Width': '3840',
  'X-Height': '2160',
  'X-Bitrate': '4000000',
};

export interface UploadOptions {
  cam?: string;
  token?: string;
  sha256?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

/** Uploads a segment through the Worker exactly as the relay does. */
export async function uploadSegment(start: string, body: Uint8Array, options: UploadOptions = {}): Promise<Response> {
  const headers = new Headers({
    Authorization: `Bearer ${options.token ?? TOKEN}`,
    'Content-Type': options.contentType ?? 'video/mp4',
    'Content-Length': String(body.byteLength),
    'X-Sha256': options.sha256 ?? (await sha256Hex(body)),
    ...RELAY_MEASUREMENTS,
    ...options.headers,
  });
  const url = `${BASE_URL}/v1/segments/${options.cam ?? CAM}/${start}`;
  return exports.default.fetch(new Request(url, { method: 'PUT', headers, body }));
}

export function request(method: string, path: string, token = TOKEN): Promise<Response> {
  const headers = { Authorization: `Bearer ${token}` };
  return exports.default.fetch(new Request(`${BASE_URL}${path}`, { method, headers }));
}

/** A segment start `minutes` in the past, named the way the relay names files. */
export function startMinutesAgo(minutes: number): string {
  return compactTimestamp(new Date(Date.now() - minutes * 60_000));
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536)); // getRandomValues caps at 64 KiB
  }
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The bytes the footage store holds at a key, or null when it holds nothing there. */
export async function storedBytes(key: string): Promise<Uint8Array | null> {
  const response = await env.STORE.fetch(storeUrl(key), { headers: { Authorization: `Bearer ${env.STORE_TOKEN}` } });
  return response.status === 404 ? null : new Uint8Array(await response.arrayBuffer());
}
