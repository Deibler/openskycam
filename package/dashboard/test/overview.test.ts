import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { CAM, EMAIL, get, minutesAgo, seedSegment } from './helpers';

interface Overview {
  viewer: { email: string };
  cameras: string[];
  cam: string;
  health: { healthy: boolean; newest_start: string | null; age_seconds: number | null };
  last_24h: { segments: number; bytes: number; seconds: number };
  retained: { segments: number; bytes: number; seconds: number };
  days: Array<{ day: string; segments: number; bytes: number; seconds: number }>;
  projection: { bytes_per_day: number | null; steady_state_bytes: number | null };
}

async function overview(): Promise<Overview> {
  const response = await get('/api/overview');
  expect(response.status).toBe(200);
  return response.json<Overview>();
}

// Storage is shared within this file, so the phases run in order in one test.
describe('GET /api/overview', () => {
  it('summarises the catalog: health, recent totals, 40 days, and the storage projection', async () => {
    const empty = await overview();
    expect(empty).toMatchObject({ viewer: { email: EMAIL }, cameras: [CAM], cam: CAM });
    expect(empty.health).toEqual({ healthy: false, newest_start: null, newest_uploaded_at: null, age_seconds: null });
    expect(empty.days).toHaveLength(40);
    expect(empty.projection.steady_state_bytes).toBeNull();

    // Two minutes recorded ten days ago (outside the last 24 hours) and two in the last few minutes.
    const tenDaysAgo = minutesAgo(10 * 24 * 60);
    await seedSegment({ start: tenDaysAgo, uploaded: tenDaysAgo, size: 25_000_000 });
    await seedSegment({ start: new Date(tenDaysAgo.getTime() + 60_000), uploaded: tenDaysAgo, size: 25_000_000 });
    await seedSegment({ start: minutesAgo(3), uploaded: minutesAgo(2), size: 30_000_000 });
    const newest = minutesAgo(2);
    await seedSegment({ start: newest, uploaded: new Date(Date.now() - 20_000), size: 30_000_000 });

    const seeded = await overview();

    expect(seeded.health).toMatchObject({ healthy: true, newest_start: newest.toISOString() });
    expect(seeded.last_24h).toEqual({ segments: 2, bytes: 60_000_000, seconds: 120 });
    expect(seeded.retained).toEqual({ segments: 4, bytes: 110_000_000, seconds: 240 });
    expect(seeded.days.find(d => d.day === tenDaysAgo.toISOString().slice(0, 10))).toMatchObject({ segments: 2 });
    // 60 MB per 120 recorded seconds -> 43.2 GB a day -> 1,728 GB over 40 days.
    expect(seeded.projection).toEqual({
      bytes_per_day: 43_200_000_000,
      steady_state_bytes: 1_728_000_000_000,
    });
  });

  it('reports a camera stale once its newest upload is more than 3 minutes old', async () => {
    // Age every upload seeded so far in this file to ten minutes ago.
    await env.CATALOG.prepare('UPDATE segments SET uploaded_at = ?').bind(minutesAgo(10).toISOString()).run();

    const stale = await overview();

    expect(stale.health.healthy).toBe(false);
    expect(stale.health.age_seconds).toBeGreaterThanOrEqual(10 * 60 - 60);
  });

  it('refuses an unknown camera', async () => {
    const response = await get('/api/overview?cam=nope');

    expect(response.status).toBe(400);
  });
});
