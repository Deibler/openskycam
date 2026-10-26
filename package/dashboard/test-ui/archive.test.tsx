import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useArchive } from '../ui/hooks/use-archive';
import { fetchOverview, fetchSegments } from '../ui/lib/archive/api.js';
import type { Overview, Segment } from '../ui/lib/types';
vi.mock('../ui/lib/archive/api.js', () => ({
  fetchOverview: vi.fn(),
  fetchSegments: vi.fn(),
  SessionExpiredError: class extends Error {},
}));
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  clear: () => stored.clear(),
});
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const sample = (day = today, minute = '00'): Segment => ({
  start: `${day}T12:${minute}:00.000Z`,
  size: 31000000,
  duration_s: 60,
  frames: 1800,
  width: 3840,
  height: 2160,
  codec: 'hevc',
  bitrate: 4100000,
});
const empty = { seconds: 0, segments: 0, bytes: 0 };
const summary: Overview = {
  cam: 'sky01',
  cameras: ['sky01'],
  viewer: { email: 'viewer@example.com' },
  generated_at: `${today}T12:00:00Z`,
  health: { healthy: true, newest_start: sample().start, newest_uploaded_at: sample().start, age_seconds: 0 },
  days: [],
  last_24h: empty,
  retained: empty,
  projection: { bytes_per_day: null, steady_state_bytes: null },
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  history.replaceState({}, '', `/?day=${today}&tz=UTC&cam=sky01`);
  vi.mocked(fetchOverview).mockResolvedValue(summary);
  vi.mocked(fetchSegments).mockResolvedValue([sample()]);
});
afterEach(cleanup);
it('keeps the API documentation deep link while footage finishes loading', async () => {
  history.replaceState({}, '', '/?view=api&tab=docs');
  const { result } = renderHook(() => useArchive());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.route.view).toBe('api');
  expect(new URLSearchParams(location.search).get('tab')).toBe('docs');
  act(() => result.current.changeView('recordings'));
  expect(new URLSearchParams(location.search).has('tab')).toBe(false);
});
it('refresh preserves the selected video request so playback is not restarted', async () => {
  const { result } = renderHook(() => useArchive());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const request = result.current.selection!.id;
  vi.mocked(fetchSegments).mockResolvedValue([sample(), sample(today, '01')]);
  await act(() => result.current.refresh());
  expect(result.current.segments).toHaveLength(2);
  expect(result.current.selection?.segment.start).toBe(sample().start);
  expect(result.current.selection?.id).toBe(request);
});
it('a late response for the old date cannot replace the selected date', async () => {
  let resolveOld!: (rows: Segment[]) => void;
  vi.mocked(fetchSegments)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce([sample(yesterday)]);
  const { result } = renderHook(() => useArchive());
  await waitFor(() => expect(fetchSegments).toHaveBeenCalledTimes(1));
  act(() => result.current.changeDay(yesterday));
  await waitFor(() => expect(result.current.selection?.segment.start).toBe(sample(yesterday).start));
  await act(async () => resolveOld([sample()]));
  expect(result.current.route.day).toBe(yesterday);
  expect(result.current.segments[0].start).toBe(sample(yesterday).start);
});
it('opening a day from activity returns to the viewer with matching URL and zone', async () => {
  const { result } = renderHook(() => useArchive());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.changeView('activity'));
  expect(location.search).toContain('view=activity');
  act(() => result.current.changeDay(yesterday, 'UTC'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.route.view).toBe('recordings');
  expect(result.current.route.zone).toBe('UTC');
  expect(location.search).not.toContain('view=activity');
  expect(location.search).toContain(`day=${yesterday}`);
});
it('restores the exact playback second on reload and when reopening the home page', async () => {
  const first = renderHook(() => useArchive());
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  act(() => first.result.current.trackProgress(sample().start, 37.4));
  expect(new URLSearchParams(location.search).get('t')).toBe('37.4');
  first.unmount();
  const reloaded = renderHook(() => useArchive());
  await waitFor(() => expect(reloaded.result.current.loading).toBe(false));
  expect(reloaded.result.current.selection?.offset).toBe(37.4);
  reloaded.unmount();
  history.replaceState({}, '', '/');
  const reopened = renderHook(() => useArchive());
  await waitFor(() => expect(reopened.result.current.loading).toBe(false));
  expect(reopened.result.current.selection?.segment.start).toBe(sample().start);
  expect(reopened.result.current.selection?.offset).toBe(37.4);
});
it('ignores late progress from the previous video after selecting a new recording', async () => {
  vi.mocked(fetchSegments).mockResolvedValue([sample(), sample(today, '01')]);
  const { result } = renderHook(() => useArchive());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.select(sample(), false, 15));
  act(() => result.current.trackProgress(sample(today, '01').start, 45));
  expect(new URLSearchParams(location.search).get('t')).toBe('15');
  expect(new URLSearchParams(location.search).get('at')).toBe(sample().start);
});
it('opens a day 35 days back, inside the 40-day retention window', async () => {
  const old = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
  const { result } = renderHook(() => useArchive());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.changeDay(old, 'UTC'));
  expect(result.current.route.day).toBe(old);
});
