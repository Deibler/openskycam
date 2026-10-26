import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAM, randomBytes, request, startMinutesAgo, uploadSegment } from './helpers';

interface Status {
  healthy: boolean;
  cameras: Array<{ cam: string; newest: string | null; age_seconds: number | null }>;
}

async function getStatus(): Promise<{ code: number; body: Status }> {
  const response = await request('GET', '/v1/status');
  return { code: response.status, body: await response.json<Status>() };
}

describe('GET /v1/status', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Storage is shared within this file, so the three phases run in order in one test.
  it('tracks how fresh the newest segment is', async () => {
    const empty = await getStatus();
    expect(empty.code).toBe(503);
    expect(empty.body.cameras).toEqual([{ cam: CAM, newest: null, age_seconds: null }]);

    await uploadSegment(startMinutesAgo(1), randomBytes(1_000));
    const fresh = await getStatus();
    expect(fresh.code).toBe(200);
    expect(fresh.body.healthy).toBe(true);

    vi.setSystemTime(Date.now() + 4 * 60_000);
    const stale = await getStatus();
    expect(stale.code).toBe(503);
    expect(stale.body.cameras[0]!.age_seconds).toBeGreaterThanOrEqual(240);
  });
});
