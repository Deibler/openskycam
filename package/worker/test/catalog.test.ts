import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { compactTimestamp, parseSegmentStart, segmentKey } from '../../shared/src/utils/layoutStorageUtil';
import { CAM, randomBytes, startMinutesAgo, uploadSegment } from './helpers';

interface DailyStats {
  segments: number;
  bytes: number;
  seconds: number;
}

function keyFor(start: string): string {
  return segmentKey(CAM, parseSegmentStart(start)!);
}

function dayOf(start: string): string {
  return parseSegmentStart(start)!.toISOString().slice(0, 10);
}

function catalogRow(key: string) {
  return env.CATALOG.prepare('SELECT * FROM segments WHERE object_key = ?').bind(key).first<Record<string, unknown>>();
}

function dailyStats(day: string) {
  return env.CATALOG.prepare('SELECT segments, bytes, seconds FROM daily_stats WHERE cam = ? AND day = ?')
    .bind(CAM, day)
    .first<DailyStats>();
}

describe('catalog', () => {
  it('records every stored segment with its measurements', async () => {
    const start = startMinutesAgo(40);
    const body = randomBytes(5_000);

    await uploadSegment(start, body);

    expect(await catalogRow(keyFor(start))).toMatchObject({
      cam: CAM,
      start: parseSegmentStart(start)!.toISOString(),
      day: dayOf(start),
      size: 5_000,
      duration_s: 60,
      frames: 1800,
      width: 3840,
      height: 2160,
      bitrate: 4_000_000,
      codec: 'hevc',
    });
  });

  it("adds each segment to its day's totals once, even when retried", async () => {
    // Noon, three days ago: a day no other test in this file writes to.
    const noon = new Date(Date.now() - 3 * 86_400_000);
    noon.setUTCHours(12, 0, 0, 0);
    const [first, second] = [0, 60_000].map(offset => compactTimestamp(new Date(noon.getTime() + offset)));
    const body = randomBytes(7_000);

    await uploadSegment(first!, body);
    await uploadSegment(first!, body); // retry: must not count again
    await uploadSegment(second!, randomBytes(3_000));

    expect(await dailyStats(dayOf(first!))).toEqual({ segments: 2, bytes: 10_000, seconds: 120 });
  });

  it('re-records a segment whose catalog row is missing when the relay retries', async () => {
    const start = startMinutesAgo(41);
    const body = randomBytes(5_000);
    await uploadSegment(start, body);
    await env.CATALOG.prepare('DELETE FROM segments WHERE object_key = ?').bind(keyFor(start)).run();

    const retry = await uploadSegment(start, body);

    expect(retry.status).toBe(200);
    expect(await catalogRow(keyFor(start))).not.toBeNull();
  });

  it("prunes rows past retention and removes their day's totals", async () => {
    const expiredDay = '2020-01-01';
    await env.CATALOG.prepare(
      `INSERT INTO segments (object_key, cam, start, day, size, sha256, uploaded_at)
       VALUES ('raw/old.mp4', ?, '2020-01-01T00:00:00.000Z', ?, 100, 'x', '2020-01-01T00:01:00.000Z')`,
    )
      .bind(CAM, expiredDay)
      .run();
    expect(await dailyStats(expiredDay)).not.toBeNull();

    await uploadSegment(startMinutesAgo(42), randomBytes(1_000));

    expect(await catalogRow('raw/old.mp4')).toBeNull();
    expect(await dailyStats(expiredDay)).toBeNull();
  });
});
