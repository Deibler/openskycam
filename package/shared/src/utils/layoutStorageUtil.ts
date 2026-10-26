/**
 * Where footage lives in the footage store (external/store). All times are UTC.
 *
 *   raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4
 *
 * The key=value folders act as partitions for DuckDB, Spark, pyarrow and Hugging Face datasets.
 * See docs/capture/catalog.md#footage-on-disk.
 */

/** Days both Workers keep footage. The store's janitor deletes files later (external/store/tests). */
export const RETENTION_DAYS = 40;
export const RETENTION_MS = RETENTION_DAYS * 86_400_000;

const COMPACT_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** Formats a time the way the relay names segments: 20260922T140500Z. */
export function compactTimestamp(time: Date): string {
  return time.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

/**
 * Parses a relay segment start such as 20260922T140500Z.
 * Returns null for malformed or impossible values (month 13, hour 25, ...).
 */
export function parseSegmentStart(value: string): Date | null {
  const match = COMPACT_TIMESTAMP.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const time = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls impossible values over (month 13 becomes January), so require a round trip.
  return compactTimestamp(time) === value ? time : null;
}

export function dayPrefix(cam: string, date: string): string {
  return `raw/cam=${cam}/date=${date}/`;
}

export function hourPrefix(cam: string, time: Date): string {
  const iso = time.toISOString();
  return `${dayPrefix(cam, iso.slice(0, 10))}hour=${iso.slice(11, 13)}/`;
}

export function segmentKey(cam: string, start: Date): string {
  return `${hourPrefix(cam, start)}${cam}_${compactTimestamp(start)}.mp4`;
}

/** The footage store (external/store), reached through each Worker's STORE binding. */
export function storeUrl(key: string): string {
  return `http://store/o/${key}`;
}
