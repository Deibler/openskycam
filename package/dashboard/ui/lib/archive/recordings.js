// Pure time and archive operations, shared by the views and their regression tests.
/** @typedef {import('./api.js').Segment} Segment */
/** @typedef {'local' | 'UTC'} Zone */

/** @param {Date} date @param {Zone} zone */
export function dayKey(date, zone) {
  const parts =
    zone === 'UTC'
      ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
      : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return parts.map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('-');
}

/** @param {string} key @param {Zone} zone */
export function parseDay(key, zone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = zone === 'UTC' ? new Date(Date.UTC(year, month - 1, day)) : new Date(year, month - 1, day);
  return Number.isFinite(date.getTime()) && dayKey(date, zone) === key ? date : null;
}

/** @param {Date} date @param {Zone} zone */
export function startOfDay(date, zone) {
  return /** @type {Date} */ (parseDay(dayKey(date, zone), zone));
}

/** Calendar arithmetic preserves 23/25-hour local days. @param {Date} date @param {number} offset @param {Zone} zone */
export function addDays(date, offset, zone) {
  const result = startOfDay(date, zone);
  if (zone === 'UTC') result.setUTCDate(result.getUTCDate() + offset);
  else result.setDate(result.getDate() + offset);
  return result;
}

/** @param {Date} date @param {Zone} zone @param {boolean} [seconds] */
export function clockTime(date, zone, seconds = false) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    ...(zone === 'UTC' ? { timeZone: 'UTC' } : {}),
    hourCycle: 'h23',
  }).format(date);
}

/** @param {Date} date @param {Zone} zone */
export function dateLabel(date, zone) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(zone === 'UTC' ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

/** @param {Date} date @param {Zone} zone */
export function hourOf(date, zone) {
  return zone === 'UTC' ? date.getUTCHours() : date.getHours();
}

/** @param {Date} day @param {string} value @param {Zone} zone */
export function timeOnDay(day, value, zone) {
  value = normalizeClockInput(value);
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const [hour, minute, second = 0] = value.split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const result = new Date(day);
  if (zone === 'UTC') result.setUTCHours(hour, minute, second, 0);
  else result.setHours(hour, minute, second, 0);
  // A nonexistent hour during a spring DST transition must not silently move forward.
  return clockTime(result, zone, value.length > 5) === value ? result : null;
}

/** Accept clock times from a phone's numeric keyboard, including optional seconds.
 * @param {string} value
 */
export function normalizeClockInput(value) {
  const trimmed = value.trim();
  return /^(\d{4}|\d{6})$/.test(trimmed) ? trimmed.replace(/(\d{2})(?=\d)/g, '$1:') : trimmed;
}

/** @param {Segment[]} segments @param {Date} time */
export function nearestRecording(segments, time) {
  if (!segments.length) return null;
  const target = time.getTime();
  let nearest = segments[0];
  let distance = Infinity;
  // Clock-aligned files can overlap by a few frames. Prefer the newer file at
  // a boundary so selecting 19:42 opens 19:42, not the end of 19:41.
  for (const segment of [...segments].sort((a, b) => b.start.localeCompare(a.start))) {
    const start = Date.parse(segment.start);
    const end = start + (segment.duration_s ?? 60) * 1000;
    if (target >= start && target < end) return { segment, offset: (target - start) / 1000, exact: true };
    const nextDistance = Math.abs(start - target);
    if (nextDistance < distance) {
      nearest = segment;
      distance = nextDistance;
    }
  }
  return { segment: nearest, offset: 0, exact: false };
}

/** @param {Segment[]} segments @param {{zone: Zone, query: string, hour: string, order: string, savedOnly: boolean, saved: Set<string>, cam: string}} options */
export function filterRecordings(segments, { zone, query, hour, order, savedOnly, saved, cam }) {
  const search = query.trim().toLowerCase();
  const filtered = segments.filter(segment => {
    const date = new Date(segment.start);
    const time = clockTime(date, zone, true);
    const twelveHour = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      ...(zone === 'UTC' ? { timeZone: 'UTC' } : {}),
    })
      .format(date)
      .toLowerCase();
    return (
      (hour === 'all' || hourOf(date, zone) === Number(hour)) &&
      (!savedOnly || saved.has(`${cam}/${segment.start}`)) &&
      (!search ||
        time.includes(search) ||
        twelveHour.includes(search) ||
        (segment.codec ?? '').toLowerCase().includes(search))
    );
  });
  return filtered.sort((a, b) =>
    order === 'oldest' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start),
  );
}

/** Quote every CSV value, including spreadsheet formula prefixes. @param {unknown} value */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** @param {Segment[]} segments @param {string} cam @param {Zone} zone */
export function recordingsCsv(segments, cam, zone) {
  const rows = [
    [
      'Camera',
      'Start (UTC)',
      `Time (${zone === 'UTC' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone})`,
      'Duration (s)',
      'Bytes',
      'Frames',
      'Width',
      'Height',
      'Codec',
      'Bitrate (bps)',
    ],
    ...segments.map(s => [
      cam,
      s.start,
      clockTime(new Date(s.start), zone, true),
      s.duration_s,
      s.size,
      s.frames,
      s.width,
      s.height,
      s.codec,
      s.bitrate,
    ]),
  ];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** @param {number} seconds */
export function mediaTime(seconds) {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
