import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordingScrubber } from '../ui/components/recording-scrubber';
import type { Segment } from '../ui/lib/types';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('skips an empty interval with arrow keys and keeps Home/End inside recorded footage', () => {
  const base = Date.parse('2026-09-22T19:00:00Z');
  const clip = (offset: number, duration_s: number): Segment => ({
    start: new Date(base + offset).toISOString(),
    duration_s,
    size: 1,
    frames: null,
    width: null,
    height: null,
    codec: null,
    bitrate: null,
  });
  const segments = [clip(0, 20), clip(300000, 60)];
  const seek = vi.fn();
  function Review() {
    const [time, setTime] = useState(base + 19000);
    return (
      <RecordingScrubber
        day={new Date('2026-09-22T00:00:00Z')}
        zone="UTC"
        segments={segments}
        selected={segments[0]}
        time={time}
        range={null}
        onClearRange={vi.fn()}
        onSeek={date => {
          seek(date);
          setTime(date.getTime());
        }}
      />
    );
  }
  render(<Review />);
  const slider = screen.getByRole('slider');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(seek).toHaveBeenLastCalledWith(new Date(base + 300000));
  expect(slider.getAttribute('aria-valuetext')).toBe('19:05:00 UTC');
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  expect(seek.mock.lastCall![0].getTime()).toBeGreaterThanOrEqual(base + 19000);
  expect(seek.mock.lastCall![0].getTime()).toBeLessThan(base + 20000);
  expect(slider.getAttribute('aria-valuetext')).toBe('19:00:19 UTC');
  fireEvent.keyDown(slider, { key: 'End' });
  expect(seek.mock.lastCall![0].getTime()).toBeGreaterThanOrEqual(base + 359000);
  expect(seek.mock.lastCall![0].getTime()).toBeLessThan(base + 360000);
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(seek).toHaveBeenLastCalledWith(new Date(base));
});
