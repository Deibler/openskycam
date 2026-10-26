import { describe, expect, it } from 'vitest';
import { CAM, get, seedSegment } from './helpers';

const path = (boundaries: string[], cam = CAM) =>
  `/api/availability?${new URLSearchParams({ cam, boundaries: boundaries.map(value => Date.parse(value)).join(',') })}`;

describe('GET /api/availability', () => {
  it('uses actual local boundaries, excludes empty days, and includes a midnight start only once', async () => {
    await seedSegment({ start: new Date('2026-09-15T00:30:00Z') });
    await seedSegment({ start: new Date('2026-09-16T04:00:00Z') });
    const local = await get(
      path(['2026-09-14T04:00:00Z', '2026-09-15T04:00:00Z', '2026-09-16T04:00:00Z', '2026-09-17T04:00:00Z']),
    );
    expect(local.status).toBe(200);
    expect(await local.json()).toEqual({ cam: CAM, days: ['2026-09-14T04:00:00.000Z', '2026-09-16T04:00:00.000Z'] });
    const utc = await get(
      path(['2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-17T00:00:00Z']),
    );
    expect(await utc.json()).toEqual({ cam: CAM, days: ['2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z'] });
  });

  it.each([
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', '2026-03-09T03:59:00Z'],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', '2026-11-02T04:59:00Z'],
  ])('checks a DST day starting %s through its real end', async (from, to, start) => {
    await seedSegment({ start: new Date(start) });
    const response = await get(path([from, to]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cam: CAM, days: [new Date(from).toISOString()] });
  });

  it('returns an empty list when no footage was recorded', async () => {
    const response = await get(path(['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z']));
    expect(await response.json()).toEqual({ cam: CAM, days: [] });
  });

  it.each([
    `/api/availability?cam=${CAM}`,
    `/api/availability?cam=${CAM}&boundaries=oops,1789430400000`,
    `/api/availability?cam=${CAM}&boundaries=1789430400000,1789430400000`,
    `/api/availability?cam=${CAM}&boundaries=1789516800000,1789430400000`,
    path(['2026-09-14T00:00:00Z', '2026-09-17T00:00:00Z']),
    `/api/availability?cam=${CAM}&boundaries=${Array.from({ length: 33 }, (_, i) => Date.UTC(2026, 8, i + 1)).join(',')}`,
    path(['2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z'], 'unknown'),
  ])('rejects an invalid or unbounded request: %s', async url => {
    expect((await get(url)).status).toBe(400);
  });
});
