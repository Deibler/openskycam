import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  clockTime,
  dayKey,
  filterRecordings,
  nearestRecording,
  parseDay,
  recordingsCsv,
  startOfDay,
  timeOnDay,
} from '../ui/lib/archive/recordings.js';
import { fetchSegments, fetchOverview, SessionExpiredError } from '../ui/lib/archive/api.js';

process.env.TZ = 'America/New_York';
const segment = (start, overrides = {}) => ({
  start,
  size: 31000000,
  duration_s: 60,
  frames: 1800,
  width: 3840,
  height: 2160,
  bitrate: 4100000,
  codec: 'hevc',
  ...overrides,
});
const recordings = [
  segment('2026-09-22T22:00:00.000Z'),
  segment('2026-09-22T22:01:00.000Z'),
  segment('2026-09-22T23:00:00.000Z'),
];

test('local and UTC archive days request different, exact ranges around midnight', () => {
  const date = new Date('2026-09-23T02:30:00Z');
  assert.equal(dayKey(date, 'local'), '2026-09-22');
  assert.equal(dayKey(date, 'UTC'), '2026-09-23');
  assert.equal(startOfDay(date, 'local').toISOString(), '2026-09-22T04:00:00.000Z');
  assert.equal(startOfDay(date, 'UTC').toISOString(), '2026-09-23T00:00:00.000Z');
});
test('the spring and fall clock changes keep all 23 or 25 hours of footage', () => {
  for (const [key, hours] of [
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ]) {
    const day = parseDay(key, 'local');
    assert.equal((addDays(day, 1, 'local') - day) / 3600000, hours);
    assert.equal((addDays(parseDay(key, 'UTC'), 1, 'UTC') - parseDay(key, 'UTC')) / 3600000, 24);
  }
});
test('invalid deep-link dates cannot roll into a different month', () => {
  for (const key of ['2026-02-30', '2026-13-01', '2026-09-00', 'not-a-date', '2026-9-22'])
    assert.equal(parseDay(key, 'UTC'), null);
  assert.equal(dayKey(parseDay('2024-02-29', 'UTC'), 'UTC'), '2024-02-29');
});
test('jump to time rejects a nonexistent spring hour', () => {
  const day = parseDay('2026-03-08', 'local');
  assert.equal(timeOnDay(day, '02:30', 'local'), null);
  assert.equal(clockTime(timeOnDay(day, '03:30', 'local'), 'local'), '03:30');
  assert.equal(timeOnDay(day, '24:00', 'local'), null);
});
test('timeline seeks within a segment and reports a gap instead of inventing coverage', () => {
  const found = nearestRecording(recordings, new Date('2026-09-22T22:00:35Z'));
  assert.equal(found.segment, recordings[0]);
  assert.equal(found.offset, 35);
  assert.equal(found.exact, true);
  const gap = nearestRecording(recordings, new Date('2026-09-22T22:59:20Z'));
  assert.equal(gap.segment, recordings[2]);
  assert.equal(gap.offset, 0);
  assert.equal(gap.exact, false);
  assert.equal(nearestRecording([], new Date()), null);
});
test('overlapping segment boundaries prefer an available recording without losing fractional coverage', () => {
  const s = segment('2026-09-22T22:00:00.000Z', { duration_s: 60.4 });
  assert.equal(nearestRecording([s], new Date('2026-09-22T22:01:00.200Z')).exact, true);
  assert.equal(nearestRecording([s], new Date('2026-09-22T22:01:00.500Z')).exact, false);
});
test('time search, hour, saved filter, and sort compose without mutating the source list', () => {
  const options = {
    zone: 'local',
    query: '18:0',
    hour: '18',
    order: 'newest',
    savedOnly: false,
    saved: new Set(),
    cam: 'sky01',
  };
  assert.deepEqual(filterRecordings(recordings, options), [recordings[1], recordings[0]]);
  assert.deepEqual(
    filterRecordings(recordings, { ...options, savedOnly: true, saved: new Set([`sky01/${recordings[0].start}`]) }),
    [recordings[0]],
  );
  assert.deepEqual(filterRecordings(recordings, { ...options, zone: 'UTC', hour: '22', query: '22:01' }), [
    recordings[1],
  ]);
  assert.equal(recordings[0].start, '2026-09-22T22:00:00.000Z');
});
test('saved recordings are scoped to the camera', () => {
  assert.deepEqual(
    filterRecordings(recordings, {
      zone: 'local',
      query: '',
      hour: 'all',
      order: 'oldest',
      savedOnly: true,
      saved: new Set([`other/${recordings[0].start}`]),
      cam: 'sky01',
    }),
    [],
  );
});
test('CSV exports exact UTC timestamps, durations, and safely escaped values', () => {
  const csv = recordingsCsv(
    [segment('2026-09-22T22:00:00.000Z', { duration_s: 59.6, frames: null, codec: 'HEVC,"main"' })],
    '=unsafe',
    'local',
  );
  assert.match(csv, /Start \(UTC\)/);
  assert.match(csv, /America\/New_York/);
  assert.match(csv, /"'\=unsafe"/);
  assert.match(csv, /"2026-09-22T22:00:00.000Z"/);
  assert.match(csv, /"18:00:00","59.6"/);
  assert.match(csv, /"HEVC,""main"""/);
});
test('cancelling an obsolete day request is not reported as a session expiry', async t => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(fetchSegments('sky01', new Date(0), new Date(1000)), { name: 'AbortError' });
});
test('network failures and authentication failures have distinct recovery messages', async t => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(
    fetchOverview(null),
    error => !(error instanceof SessionExpiredError) && error.message.includes('connection'),
  );
});
test('login redirects and rejected sessions ask the user to sign in again', async t => {
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
  );
  await assert.rejects(fetchOverview(null), SessionExpiredError);
  mock.mock.mockImplementation(async () => new Response('', { status: 401 }));
  await assert.rejects(fetchOverview(null), SessionExpiredError);
});
