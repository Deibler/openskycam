import { addDays, clockTime, normalizeClockInput, timeOnDay } from './archive/recordings.js';
import type { Segment, Zone } from './types';

export type TimelineScale = 'clip' | 'hour' | 'day';
export type RecordingHour = {
  start: number;
  label: string;
  offset: string;
  segments: Segment[];
  minutes: Map<number, Segment[]>;
};

export function adjacentRecordedDay(
  days: ReadonlySet<string> | null,
  day: string,
  direction: -1 | 1,
): string | undefined {
  const ordered = [...(days ?? [])].sort();
  return direction === -1 ? ordered.findLast(key => key < day) : ordered.find(key => key > day);
}

// Subtract clock minutes from the actual instant so repeated DST hours stay separate.
export function hourStart(time: number, zone: Zone) {
  const date = new Date(time);
  const minutes = zone === 'UTC' ? date.getUTCMinutes() : date.getMinutes();
  return time - minutes * 60000 - date.getSeconds() * 1000 - date.getMilliseconds();
}

export function recordingHours(segments: Segment[], zone: Zone, rangeStart = -Infinity): RecordingHour[] {
  const groups = new Map<number, RecordingHour>();
  for (const segment of segments) {
    // A clip that begins before a review range is selectable at its first included minute.
    const time = Math.max(Date.parse(segment.start), rangeStart);
    const start = hourStart(time, zone);
    let group = groups.get(start);
    if (!group) {
      const offset =
        new Intl.DateTimeFormat('en', { timeZoneName: 'shortOffset', ...(zone === 'UTC' ? { timeZone: 'UTC' } : {}) })
          .formatToParts(new Date(start))
          .find(p => p.type === 'timeZoneName')?.value ?? '';
      group = { start, label: clockTime(new Date(start), zone), offset, segments: [], minutes: new Map() };
      groups.set(start, group);
    }
    group.segments.push(segment);
    const minute = Math.floor((time - start) / 60000);
    group.minutes.set(minute, [...(group.minutes.get(minute) ?? []), segment]);
  }
  return [...groups.values()]
    .sort((a, b) => a.start - b.start)
    .map(group => {
      group.segments.sort((a, b) => a.start.localeCompare(b.start));
      for (const rows of group.minutes.values()) rows.sort((a, b) => a.start.localeCompare(b.start));
      return group;
    });
}

export function playbackWindow(day: Date, zone: Zone, scale: TimelineScale, segment: Segment | null) {
  const start = segment ? Date.parse(segment.start) : day.getTime();
  if (scale === 'clip' && segment) return { from: start, to: start + Math.max(1, segment.duration_s ?? 60) * 1000 };
  if (scale === 'hour') {
    const from = hourStart(start, zone);
    return { from, to: from + 3600000 };
  }
  return { from: day.getTime(), to: addDays(day, 1, zone).getTime() };
}

export function coverageRanges(segments: Segment[], from: number, to: number) {
  const ranges: { start: number; end: number }[] = [];
  for (const segment of [...segments].sort((a, b) => a.start.localeCompare(b.start))) {
    const start = Math.max(from, Date.parse(segment.start));
    const end = Math.min(to, Date.parse(segment.start) + (segment.duration_s ?? 60) * 1000);
    if (end <= start) continue;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}

/** Trim empty edges, preserving any gaps between the recordings inside a review range. */
export function recordedRange(segments: Segment[], from: number, to: number) {
  const ranges = coverageRanges(segments, from, to);
  return ranges.length ? { from: ranges[0].start, to: ranges.at(-1)!.end } : null;
}

/** Minute entry opens footage in that minute; second entry must match that exact moment. */
export function timeWithFootage(segments: Segment[], day: Date, input: string, zone: Zone) {
  const time = timeOnDay(day, input, zone)?.getTime();
  if (time === undefined) return null;
  const minutePrecision = normalizeClockInput(input).length === 5;
  const first = coverageRanges(segments, time, time + (minutePrecision ? 60000 : 1))[0];
  return first ? new Date(first.start) : null;
}

/** Keep seeks inside recorded intervals; directional keyboard seeks skip gaps without getting stuck. */
export function snapToFootage(ranges: { start: number; end: number }[], time: number, direction = 0): number | null {
  if (!ranges.length) return null;
  if (ranges.some(range => time >= range.start && time < range.end)) return time;
  const before = ranges.findLast(range => range.end <= time);
  const after = ranges.find(range => range.start > time);
  if (!before) return ranges[0].start;
  if (!after) return ranges.at(-1)!.end - 1;
  if (direction > 0) return after.start;
  if (direction < 0) return before.end - 1;
  return time - before.end < after.start - time ? before.end - 1 : after.start;
}
