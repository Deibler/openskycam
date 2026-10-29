import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { parseSegmentStart, segmentKey } from '../../shared/src/utils/layoutStorageUtil';
import { CAM, randomBytes, request, sha256Hex, startMinutesAgo, storedBytes, uploadSegment } from './helpers';

function keyFor(start: string): string {
  return segmentKey(CAM, parseSegmentStart(start)!);
}

async function countSegments(): Promise<number> {
  return (await env.CATALOG.prepare('SELECT COUNT(*) AS n FROM segments').first<{ n: number }>())!.n;
}

describe('PUT /v1/segments/:cam/:start', () => {
  it('stores a new segment, byte for byte, and catalogs its metadata', async () => {
    const start = startMinutesAgo(10);
    const body = randomBytes(300_000);

    const response = await uploadSegment(start, body);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ key: keyFor(start), size: body.byteLength });
    const stored = await storedBytes(keyFor(start));
    expect(stored).not.toBeNull();
    expect(await sha256Hex(stored!)).toBe(await sha256Hex(body));
    const row = await env.CATALOG.prepare(
      'SELECT start, size, sha256, duration_s, frames, codec, width, height, bitrate FROM segments WHERE object_key = ?',
    )
      .bind(keyFor(start))
      .first();
    expect(row).toEqual({
      start: parseSegmentStart(start)!.toISOString(),
      size: body.byteLength,
      sha256: await sha256Hex(body),
      duration_s: 60,
      frames: 1800,
      codec: 'hevc',
      width: 3840,
      height: 2160,
      bitrate: 4000000,
    });
  });

  it('treats a retry of the same bytes as success', async () => {
    const start = startMinutesAgo(11);
    const body = randomBytes(10_000);
    await uploadSegment(start, body);

    const retry = await uploadSegment(start, body);

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ key: keyFor(start), stored: 'already' });
  });

  it('refuses different bytes at an existing key and keeps the original', async () => {
    const start = startMinutesAgo(12);
    const original = randomBytes(10_000);
    await uploadSegment(start, original);

    const conflicting = await uploadSegment(start, randomBytes(10_000));

    expect(conflicting.status).toBe(409);
    expect(await sha256Hex((await storedBytes(keyFor(start)))!)).toBe(await sha256Hex(original));
  });

  it('refuses a body that does not match X-Sha256 and stores nothing', async () => {
    const start = startMinutesAgo(13);
    const wrongChecksum = await sha256Hex(randomBytes(16));
    const segmentsBefore = await countSegments();

    const response = await uploadSegment(start, randomBytes(10_000), { sha256: wrongChecksum });

    expect(response.status).toBe(422);
    expect(await storedBytes(keyFor(start))).toBeNull();
    expect(await countSegments()).toBe(segmentsBefore);
  });

  it.each([
    ['an unknown token', startMinutesAgo(20), { token: 'wrong' }, 401],
    ['an unknown camera', startMinutesAgo(21), { cam: 'nope' }, 403],
    ['an impossible start time', '20261340T256199Z', {}, 400],
    ['a start older than the retention window', startMinutesAgo(41 * 24 * 60), {}, 400],
    ['a start in the future', startMinutesAgo(-10), {}, 400],
    ['a non-video content type', startMinutesAgo(22), { contentType: 'text/plain' }, 415],
    ['a malformed checksum', startMinutesAgo(23), { sha256: 'abc' }, 400],
    ['a non-numeric measurement', startMinutesAgo(24), { headers: { 'X-Frames': 'lots' } }, 400],
    ['a segment over 95 MB', startMinutesAgo(25), { headers: { 'Content-Length': String(96 * 1024 * 1024) } }, 413],
  ])('rejects %s', async (_case, start, options, status) => {
    const segmentsBefore = await countSegments();

    const response = await uploadSegment(start, randomBytes(1_000), options);

    expect(response.status).toBe(status);
    expect(await countSegments()).toBe(segmentsBefore);
    if (parseSegmentStart(start)) expect(await storedBytes(keyFor(start))).toBeNull();
  });
});

describe('routing', () => {
  it('returns 404 for unknown paths', async () => {
    expect((await request('GET', '/v1/nothing')).status).toBe(404);
  });

  it('returns 405 for a known path with the wrong method', async () => {
    expect((await request('DELETE', `/v1/segments/${CAM}/${startMinutesAgo(30)}`)).status).toBe(405);
  });

  it('refuses every route without a valid token', async () => {
    expect((await request('GET', '/v1/status', 'wrong')).status).toBe(401);
  });
});
