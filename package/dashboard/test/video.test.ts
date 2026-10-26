import { beforeAll, describe, expect, it } from 'vitest';
import { CAM, get, seedSegment } from './helpers';

const body = new Uint8Array(1_000).map((_, i) => i % 251);
let start: string;

beforeAll(async () => {
  start = await seedSegment({ start: new Date(Date.UTC(2026, 8, 21, 8, 30, 0)), body });
});

async function bytes(response: Response): Promise<number[]> {
  return [...new Uint8Array(await response.arrayBuffer())];
}

describe('GET /api/video/:cam/:start', () => {
  it('streams the whole segment', async () => {
    const response = await get(`/api/video/${CAM}/${start}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await bytes(response)).toEqual([...body]);
  });

  it('serves a byte range, which is how the player seeks', async () => {
    const response = await get(`/api/video/${CAM}/${start}`, { headers: { Range: 'bytes=100-199' } });

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 100-199/1000');
    expect(await bytes(response)).toEqual([...body.slice(100, 200)]);
  });

  it('serves the last bytes for a suffix range', async () => {
    const response = await get(`/api/video/${CAM}/${start}`, { headers: { Range: 'bytes=-10' } });

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 990-999/1000');
    expect(await bytes(response)).toEqual([...body.slice(990)]);
  });

  it('offers a download with a meaningful file name', async () => {
    const response = await get(`/api/video/${CAM}/${start}?download`);

    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="${CAM}_${start}.mp4"`);
  });

  it.each([
    ['a minute with no recording', `/api/video/${CAM}/20260921T083100Z`, 404],
    ['a malformed start', `/api/video/${CAM}/yesterday`, 400],
    ['an unknown camera', `/api/video/nope/20260921T083000Z`, 400],
  ])('answers %s with an error', async (_case, path, status) => {
    expect((await get(path)).status).toBe(status);
  });
});
