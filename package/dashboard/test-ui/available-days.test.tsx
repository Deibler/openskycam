import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAvailableDays } from '../ui/hooks/use-available-days';
import { fetchAvailableDays } from '../ui/lib/archive/api.js';
import { dayKey } from '../ui/lib/archive/recordings.js';
import type { Zone } from '../ui/lib/types';
vi.mock('../ui/lib/archive/api.js', () => ({ fetchAvailableDays: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-22T20:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('requests actual local midnights and maps availability to local calendar labels', async () => {
  const start = new Date(2026, 8, 21);
  vi.mocked(fetchAvailableDays).mockResolvedValue([start.toISOString()]);
  const { result } = renderHook(() => useAvailableDays('sky01', 'local', 'first'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect([...result.current.days!]).toEqual(['2026-09-21']);
  const boundaries = vi.mocked(fetchAvailableDays).mock.calls.flatMap(call => call[1]);
  expect(boundaries.every(date => date.getHours() === 0 && date.getMinutes() === 0)).toBe(true);
  expect(dayKey(boundaries.at(-1)!, 'local')).toBe('2026-09-23');
});

it('clears old camera availability and ignores late responses after changing context', async () => {
  let resolveOld!: (days: string[]) => void;
  vi.mocked(fetchAvailableDays).mockImplementation(cam =>
    cam === 'old'
      ? new Promise(resolve => {
          resolveOld = resolve;
        })
      : Promise.resolve(['2026-09-20T00:00:00.000Z']),
  );
  const { result, rerender } = renderHook(
    ({ cam, zone }: { cam: string; zone: Zone }) => useAvailableDays(cam, zone, 'first'),
    { initialProps: { cam: 'old', zone: 'local' as Zone } },
  );
  rerender({ cam: 'new', zone: 'UTC' });
  expect(result.current.days).toBeNull();
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => resolveOld(['2026-09-21T00:00:00.000Z']));
  expect([...result.current.days!]).toEqual(['2026-09-20']);
  expect(vi.mocked(fetchAvailableDays).mock.calls[0][2]?.aborted).toBe(true);
});

it('allows retry after a failure and refreshes availability with a new catalog overview', async () => {
  // Each refresh makes two requests (the window is split to fit the API's 32-boundary limit).
  const rounds = [
    new Error('offline'),
    ['2026-09-20T00:00:00.000Z'],
    ['2026-09-20T00:00:00.000Z', '2026-09-22T00:00:00.000Z'],
  ];
  let requests = 0;
  vi.mocked(fetchAvailableDays).mockImplementation(async () => {
    const round = rounds[Math.floor(requests++ / 2)];
    if (round instanceof Error) throw round;
    return round;
  });
  const { result, rerender } = renderHook(({ revision }) => useAvailableDays('sky01', 'UTC', revision), {
    initialProps: { revision: 'first' },
  });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.days).toBeNull();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.days?.size).toBe(1));
  rerender({ revision: 'second' });
  await waitFor(() => expect(result.current.days?.has('2026-09-22')).toBe(true));
});

it('checks every day in the 40-day retention window in requests the API accepts', async () => {
  vi.mocked(fetchAvailableDays).mockImplementation(async (_cam, boundaries) => [boundaries[0].toISOString()]);
  const { result } = renderHook(() => useAvailableDays('sky01', 'UTC', 'first'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const calls = vi.mocked(fetchAvailableDays).mock.calls.map(call => call[1]);
  expect(calls.every(boundaries => boundaries.length <= 32)).toBe(true); // /api/availability rejects more than 32
  expect(dayKey(new Date(Math.min(...calls.flat().map(date => date.getTime()))), 'UTC')).toBe('2026-08-13');
  expect(result.current.days?.has('2026-08-13')).toBe(true);
});
