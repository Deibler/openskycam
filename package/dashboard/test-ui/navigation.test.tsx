import { expect, it } from 'vitest';
import {
  adjacentRecordedDay,
  coverageRanges,
  playbackWindow,
  recordedRange,
  recordingHours,
  snapToFootage,
  timeWithFootage,
} from '../ui/lib/archive-navigation';
import { nearestRecording, timeOnDay } from '../ui/lib/archive/recordings.js';
import type { Segment } from '../ui/lib/types';
const clip = (start: string, duration_s = 60): Segment => ({
  start,
  duration_s,
  size: 1,
  frames: null,
  width: null,
  height: null,
  codec: null,
  bitrate: null,
});
it('selects the new minute at an overlapping file boundary', () => {
  const old = clip('2026-09-22T19:41:00.000Z', 60.12);
  const next = clip('2026-09-22T19:42:00.000Z');
  expect(nearestRecording([old, next], new Date(next.start))).toEqual({ segment: next, offset: 0, exact: true });
});
it('keeps all restart files in the same minute available to the browser', () => {
  const groups = recordingHours([clip('2026-09-22T19:42:30.000Z', 29), clip('2026-09-22T19:42:00.000Z', 20)], 'UTC');
  expect(groups).toHaveLength(1);
  expect(groups[0].minutes.get(42)?.map(s => s.start)).toEqual([
    '2026-09-22T19:42:00.000Z',
    '2026-09-22T19:42:30.000Z',
  ]);
});

it('keeps a clip crossing an hour boundary selectable inside the requested range', () => {
  const recording = clip('2026-09-22T19:59:40.000Z', 60);
  const start = Date.parse('2026-09-22T20:00:00.000Z');
  const groups = recordingHours([recording], 'UTC', start);
  expect(groups).toHaveLength(1);
  expect(groups[0].start).toBe(start);
  expect(groups[0].minutes.get(0)).toEqual([recording]);
});
it('clamps timeline coverage at the range edges and retains real recording gaps', () => {
  const start = Date.parse('2026-09-22T19:00:00.000Z');
  const ranges = coverageRanges(
    [clip('2026-09-22T19:00:00.000Z', 20), clip('2026-09-22T19:00:30.000Z', 60)],
    start + 10000,
    start + 60000,
  );
  expect(ranges).toEqual([
    { start: start + 10000, end: start + 20000 },
    { start: start + 30000, end: start + 60000 },
  ]);
});
it('supports exact second time entry and uses the selected recording for clip zoom', () => {
  const day = new Date('2026-09-22T00:00:00.000Z');
  expect(timeOnDay(day, '19:42:30', 'UTC')?.toISOString()).toBe('2026-09-22T19:42:30.000Z');
  expect(timeOnDay(day, '194230', 'UTC')?.toISOString()).toBe('2026-09-22T19:42:30.000Z');
  expect(timeOnDay(day, '1942', 'UTC')?.toISOString()).toBe('2026-09-22T19:42:00.000Z');
  expect(timeOnDay(day, '19:42:99', 'UTC')).toBeNull();
  const selected = clip('2026-09-22T19:42:00.000Z', 59.4);
  expect(playbackWindow(day, 'UTC', 'clip', selected)).toEqual({
    from: Date.parse(selected.start),
    to: Date.parse(selected.start) + 59400,
  });
});

it('skips empty days in both directions and stops at the archive edges', () => {
  const days = new Set(['2026-09-20', '2026-09-13', '2026-09-22']);
  expect(adjacentRecordedDay(days, '2026-09-20', -1)).toBe('2026-09-13');
  expect(adjacentRecordedDay(days, '2026-09-20', 1)).toBe('2026-09-22');
  expect(adjacentRecordedDay(days, '2026-09-22', 1)).toBeUndefined();
  expect(adjacentRecordedDay(null, '2026-09-20', -1)).toBeUndefined();
});

it('accepts a partially recorded minute but rejects an exact second in a gap', () => {
  const day = new Date('2026-09-22T00:00:00Z');
  const recordings = [clip('2026-09-22T19:42:01.000Z', 20), clip('2026-09-22T19:42:30.000Z', 15)];
  expect(timeWithFootage(recordings, day, '1942', 'UTC')).toEqual(new Date(recordings[0].start));
  expect(timeWithFootage(recordings, day, '19:42:00', 'UTC')).toBeNull();
  expect(timeWithFootage(recordings, day, '19:42:25', 'UTC')).toBeNull();
  expect(timeWithFootage(recordings, day, '19:42:32', 'UTC')).toEqual(new Date('2026-09-22T19:42:32Z'));
  expect(timeWithFootage(recordings, day, '19:43', 'UTC')).toBeNull();
});

it('trims only empty range edges and refuses a completely empty interval', () => {
  const recordings = [clip('2026-09-22T19:42:00.000Z', 20), clip('2026-09-22T19:42:30.000Z', 15)];
  const start = Date.parse(recordings[0].start);
  expect(recordedRange(recordings, start - 60000, start + 60000)).toEqual({ from: start, to: start + 45000 });
  expect(recordedRange(recordings, start + 21000, start + 29000)).toBeNull();
});

it('snaps only to real coverage and advances across gaps for keyboard seeking', () => {
  const ranges = [
    { start: 1000, end: 2000 },
    { start: 8000, end: 9000 },
  ];
  expect(snapToFootage(ranges, 1500)).toBe(1500);
  expect(snapToFootage(ranges, 0)).toBe(1000);
  expect(snapToFootage(ranges, 10000)).toBe(8999);
  expect(snapToFootage(ranges, 3000)).toBe(1999);
  expect(snapToFootage(ranges, 3000, 1)).toBe(8000);
  expect(snapToFootage(ranges, 7000, -1)).toBe(1999);
  expect(snapToFootage([], 3000)).toBeNull();
});
