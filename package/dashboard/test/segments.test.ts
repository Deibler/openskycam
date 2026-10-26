import { describe, expect, it } from 'vitest';
import { CAM, get, seedSegment } from './helpers';

function query(from: Date, to: Date, cam = CAM): string {
  return `/api/segments?cam=${cam}&from=${from.toISOString()}&to=${to.toISOString()}`;
}

describe('GET /api/segments', () => {
  it('returns the segments starting inside the range, oldest first', async () => {
    const base = new Date(Date.UTC(2026, 8, 20, 12, 0, 0));
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
    for (const minutes of [5, -1, 0, 60]) {
      await seedSegment({ start: at(minutes) });
    }

    const response = await get(query(at(0), at(60)));

    expect(response.status).toBe(200);
    const { segments } = await response.json<{ segments: Array<{ start: string; frames: number }> }>();
    expect(segments.map(s => s.start)).toEqual([at(0).toISOString(), at(5).toISOString()]);
    expect(segments[0]).toMatchObject({ frames: 1800, width: 3840, height: 2160, codec: 'hevc' });
  });

  it.each([
    ['a range longer than 48 hours', query(new Date(0), new Date(49 * 3_600_000))],
    ['an empty range', query(new Date(1000), new Date(1000))],
    ['a missing start', `/api/segments?cam=${CAM}&to=2026-09-22T00:00:00Z`],
    ['an unknown camera', query(new Date(0), new Date(3_600_000), 'nope')],
  ])('refuses %s', async (_case, path) => {
    expect((await get(path)).status).toBe(400);
  });
});

describe('routing', () => {
  it('returns 404 for unknown API paths', async () => {
    expect((await get('/api/nothing')).status).toBe(404);
  });
});
