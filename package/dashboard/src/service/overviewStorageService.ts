import { dailySummaries, newestSegment, totalsUploadedSince } from '../db/CatalogStorageOps';
import type { DaySummary, NewestSegment, Totals } from '../models/catalogStoragemodel';
import { DAY_MS, STALE_AFTER_MS } from '../utils/configStorageUtil';
import { RETENTION_DAYS } from '../../../shared/src/utils/layoutStorageUtil';
import { cameraIds, requireKnownCamera } from './cameraStorageService';
import type { App } from '../models/applicationSharedmodel';
import type { StorageOverview, StorageHealth, StorageProjection } from '../models/overviewStoragemodel';
/**
 * GET /api/overview?cam=
 *
 * Everything the dashboard header, stat tiles and retention-window chart need, in one request.
 */
export async function getOverview(app: App, requestedCam: string | null): Promise<StorageOverview> {
  const { env, viewer } = app;
  const cam = requestedCam ? requireKnownCamera(env, requestedCam) : cameraIds(env)[0]!;
  const now = new Date();
  const days = lastDays(now, RETENTION_DAYS);

  const [summaries, last24h, newest] = await Promise.all([
    dailySummaries(env.CATALOG, cam, days[0]!),
    totalsUploadedSince(env.CATALOG, cam, new Date(now.getTime() - DAY_MS)),
    newestSegment(env.CATALOG, cam),
  ]);
  const series = fillMissingDays(days, summaries);

  return {
    viewer,
    cameras: cameraIds(env),
    cam,
    generated_at: now.toISOString(),
    health: health(newest, now),
    last_24h: last24h,
    retained: sum(series),
    days: series,
    projection: projection(last24h),
  };
}

function health(newest: NewestSegment | null, now: Date): StorageHealth {
  if (!newest) {
    return {
      healthy: false,
      newest_start: null,
      newest_uploaded_at: null,
      age_seconds: null,
    };
  }
  const ageMs = now.getTime() - Date.parse(newest.uploaded_at);
  return {
    healthy: ageMs <= STALE_AFTER_MS,
    newest_start: newest.start,
    newest_uploaded_at: newest.uploaded_at,
    age_seconds: Math.round(ageMs / 1000),
  };
}

/**
 * Footage size once the retention window is full, if the camera records around the clock at the recent bitrate.
 * Uses bytes per recorded second, so it is meaningful even when recording started an hour ago.
 */
function projection(recent: Totals): StorageProjection {
  if (recent.seconds <= 0) {
    return {
      bytes_per_day: null,
      steady_state_bytes: null,
    };
  }
  const bytesPerDay = (recent.bytes / recent.seconds) * 86_400;
  return {
    bytes_per_day: Math.round(bytesPerDay),
    steady_state_bytes: Math.round(bytesPerDay * RETENTION_DAYS),
  };
}

/** The last `count` UTC dates ending today, oldest first (YYYY-MM-DD). */
function lastDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(now.getTime() - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

function fillMissingDays(days: string[], summaries: DaySummary[]): DaySummary[] {
  const byDay = new Map(summaries.map(s => [s.day, s]));
  return days.map(day => byDay.get(day) ?? { day, segments: 0, bytes: 0, seconds: 0 });
}

function sum(days: DaySummary[]): Totals {
  return days.reduce(
    (total, d) => ({
      segments: total.segments + d.segments,
      bytes: total.bytes + d.bytes,
      seconds: total.seconds + d.seconds,
    }),
    { segments: 0, bytes: 0, seconds: 0 },
  );
}
