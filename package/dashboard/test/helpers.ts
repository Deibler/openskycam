import { env, exports } from 'cloudflare:workers';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { vi } from 'vitest';
import { compactTimestamp, segmentKey, storeUrl } from '../../shared/src/utils/layoutStorageUtil';

export const CAM = 'sky01';
export const EMAIL = 'viewer@example.com';
const TEAM_DOMAIN = 'https://test-team.cloudflareaccess.com';
const AUDIENCE = 'test-audience';
const BASE_URL = 'https://openskycam.test';

// --- Simulated Cloudflare Access ---

const accessKeys = generateKeyPair('RS256', { extractable: true });

// The Worker fetches Access's public keys; answer with the test key instead of the network.
const realFetch = globalThis.fetch;
vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === `${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
    const jwk = await exportJWK((await accessKeys).publicKey);
    return Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] });
  }
  return realFetch(input, init);
});

export interface TokenOptions {
  email?: string;
  audience?: string;
  issuer?: string;
  expiresIn?: string;
  /** Sign with a key Access never published. */
  foreignKey?: boolean;
}

/** A token shaped like the one Cloudflare Access adds to each request it lets through. */
export async function accessToken(options: TokenOptions = {}): Promise<string> {
  const key = options.foreignKey ? (await generateKeyPair('RS256')).privateKey : (await accessKeys).privateKey;
  return new SignJWT({ email: options.email ?? EMAIL })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? TEAM_DOMAIN)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(key);
}

/** Requests a path from the dashboard Worker as a signed-in viewer (or with the given token). */
export async function get(path: string, init: { token?: string | null; headers?: Record<string, string> } = {}) {
  const token = init.token === undefined ? await accessToken() : init.token;
  const headers = new Headers(init.headers);
  if (token) headers.set('Cf-Access-Jwt-Assertion', token);
  return exports.default.fetch(new Request(`${BASE_URL}${path}`, { headers }));
}

// --- Seeding the catalog and bucket the way the ingest Worker would ---

export interface SeedSegment {
  start: Date;
  uploaded?: Date;
  size?: number;
  durationS?: number;
  body?: Uint8Array;
}

export async function seedSegment(segment: SeedSegment): Promise<string> {
  const key = segmentKey(CAM, segment.start);
  const start = segment.start.toISOString();
  const size = segment.body?.byteLength ?? segment.size ?? 30_000_000;
  await env.CATALOG.prepare(
    `INSERT INTO segments (object_key, cam, start, day, size, duration_s, frames, width, height, bitrate, codec, sha256, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, 1800, 3840, 2160, 4000000, 'hevc', 'x', ?)`,
  )
    .bind(
      key,
      CAM,
      start,
      start.slice(0, 10),
      size,
      segment.durationS ?? 60,
      (segment.uploaded ?? new Date()).toISOString(),
    )
    .run();
  if (segment.body) {
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', segment.body))];
    const stored = await env.STORE.fetch(storeUrl(key), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.STORE_TOKEN}`,
        'X-Sha256': digest.map(b => b.toString(16).padStart(2, '0')).join(''),
      },
      body: segment.body,
    });
    if (!stored.ok) throw new Error(`fake footage store answered ${stored.status}`);
  }
  return compactTimestamp(segment.start);
}

export function minutesAgo(minutes: number): Date {
  const time = new Date(Date.now() - minutes * 60_000);
  time.setUTCSeconds(0, 0);
  return time;
}
