// Formatting helpers. Every function returns plain text; callers insert it with textContent.

const integer = new Intl.NumberFormat();
const utcDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const clockWithSeconds = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** @param {number} value */
export function formatInteger(value) {
  return integer.format(value);
}

/** Decimal units, as R2 bills them. @param {number} bytes */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit >= 3 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** "18 h 32 min", "45 min", "52 s". @param {number} seconds */
export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** "just now", "42 s ago", "5 min ago", "3 h ago". @param {number} seconds */
export function formatAge(seconds) {
  if (seconds < 5) return 'just now';
  if (seconds < 90) return `${Math.round(seconds)} s ago`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

/** @param {number} bitsPerSecond */
export function formatBitrate(bitsPerSecond) {
  return `${(bitsPerSecond / 1e6).toFixed(2)} Mbps`;
}

/** "Sep 22" for a UTC date string (YYYY-MM-DD). @param {string} isoDay */
export function formatUtcDay(isoDay) {
  return utcDay.format(new Date(`${isoDay}T00:00:00Z`));
}

/** Local wall-clock time, "18:05". @param {Date} time */
export function formatClock(time) {
  return clock.format(time);
}

/** Local wall-clock time, "18:05:00". @param {Date} time */
export function formatClockWithSeconds(time) {
  return clockWithSeconds.format(time);
}

/** "Tue, Sep 22, 2026". @param {Date} time */
export function formatLongDate(time) {
  return longDate.format(time);
}

/** The relay's file-name timestamp for a time: 20260922T140500Z. @param {Date} time */
export function compactTimestamp(time) {
  return time.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

/** The viewer's time zone name, e.g. "America/New_York". */
export function timeZoneName() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
