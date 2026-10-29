import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatasetVersions } from '../ui/features/workshop/components/dataset-versions';

let hidden = true;
beforeEach(() => {
  hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ versions: [], accepted: 0 }), {
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reads as soon as a page opened in a background tab is shown, then keeps one poll going', async () => {
  vi.useFakeTimers();
  render(<DatasetVersions bucketId="b" />);
  expect(fetch).not.toHaveBeenCalled();
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  // Showing the page again while the poll is current reads nothing extra.
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(29000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
