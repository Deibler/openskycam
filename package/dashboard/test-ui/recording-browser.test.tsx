import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordingBrowser } from '../ui/components/recording-browser';
import { TooltipProvider } from '../ui/components/ui/tooltip';
import type { ReviewRange, Segment } from '../ui/lib/types';

const clip = (time: string): Segment => ({
  start: `2026-09-22T${time}.000Z`,
  duration_s: 60,
  size: 1,
  frames: null,
  width: null,
  height: null,
  codec: null,
  bitrate: null,
});
const segments = [clip('18:30:00'), clip('19:42:00')];
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(rows = segments) {
  const select = vi.fn();
  const seek = vi.fn();
  const rangeChange = vi.fn();
  function Review() {
    const search = useRef<HTMLInputElement>(null);
    const [range, setRange] = useState<ReviewRange | null>(null);
    return (
      <TooltipProvider>
        <RecordingBrowser
          dayKey="2026-09-22"
          zone="UTC"
          cam="sky01"
          segments={rows}
          selected={rows[0]}
          playhead={Date.parse(rows[0].start)}
          loading={false}
          saved={new Set([`sky01/${segments[1].start}`])}
          range={range}
          searchRef={search}
          onSelect={select}
          onSeek={seek}
          onRange={value => {
            rangeChange(value);
            setRange(value);
          }}
          notify={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  render(<Review />);
  return { select, seek, rangeChange };
}
it('expands another hour without changing playback and returns to the playing minute', () => {
  const { select } = setup();
  expect(
    screen.getByRole('button', { name: '18:30, 1 recording, currently in player' }).getAttribute('aria-current'),
  ).toBe('true');
  expect(screen.queryByRole('button', { name: 'Show playing recording' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Browse 19:00 – 20:00' }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Show playing recording' }));
  expect(screen.getByRole('button', { name: '18:30, 1 recording, currently in player' })).toBeTruthy();
});
it('uses one time field to seek to exact seconds and rejects invalid input without playing', () => {
  const { seek } = setup();
  const field = screen.getByLabelText('Go to time');
  fireEvent.change(field, { target: { value: '194230' } });
  fireEvent.click(screen.getByRole('button', { name: 'Play at this time' }));
  expect(seek).toHaveBeenCalledWith(new Date('2026-09-22T19:42:30.000Z'));
  fireEvent.change(field, { target: { value: '19:42:99' } });
  fireEvent.click(screen.getByRole('button', { name: 'Play at this time' }));
  expect(seek).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert').textContent).toContain('24-hour time');
});
it('shows a saved filter explicitly and clearing it restores all hours', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Filter recordings' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Saved only' }));
  fireEvent.click(screen.getByRole('button', { name: 'Filter recordings' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Browse 18:00 – 19:00' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Browse 19:00 – 20:00' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear saved-only filter' }));
  expect(screen.getByRole('button', { name: 'Browse 18:00 – 19:00' })).toBeTruthy();
});
it('trims an overwide range to recorded edges, including an exact midnight input', async () => {
  const { rangeChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Choose time range' }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '19:40:00' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '240000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review range' }));
  expect(rangeChange).toHaveBeenCalledWith({
    from: Date.parse('2026-09-22T19:42:00Z'),
    to: Date.parse('2026-09-22T19:43:00Z'),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clear time range' }).textContent).toContain('19:42 – 19:43'),
  );
  expect(screen.queryByRole('button', { name: 'Browse 18:00 – 19:00' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear time range' }));
  expect(rangeChange).toHaveBeenLastCalledWith(null);
});

it('keeps playback in place when a valid clock time has no footage', () => {
  const { seek, select } = setup();
  const input = screen.getByLabelText('Go to time');
  fireEvent.change(input, { target: { value: '12:00:00' } });
  fireEvent.submit(input.closest('form')!);
  expect(seek).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('No footage at this time');
  expect((input as HTMLInputElement).value).toBe('12:00:00');
  expect((screen.getByRole('button', { name: '18:31, no footage' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Browse 17:00 – 18:00' })).toBeNull();
});

it('keeps an empty range unapplied and leaves the panel open with an explanation', () => {
  const { rangeChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Choose time range' }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '12:00' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '13:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review range' }));
  expect(rangeChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('No footage in this time range');
  expect(screen.getByRole('button', { name: 'Review range' })).toBeTruthy();
});

it('shows a range across hours continuously and keeps every included minute selectable', async () => {
  const start = Date.parse('2026-09-22T19:30:00Z');
  const rows = Array.from({ length: 60 }, (_, index) => ({
    ...clip('19:30:00'),
    start: new Date(start + index * 60000).toISOString(),
  }));
  const { rangeChange, select } = setup(rows);
  fireEvent.click(screen.getByRole('button', { name: 'Choose time range' }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '19:30' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '20:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review range' }));
  expect(rangeChange).toHaveBeenCalledWith({ from: start, to: start + 3600000 });
  await waitFor(() => expect(screen.getByRole('heading', { name: /^19:30 – 20:00/ })).toBeTruthy());
  expect(screen.getByRole('heading', { name: /^20:00 – 20:30/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Browse \d/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '20:20, 1 recording' }));
  expect(select).toHaveBeenCalledWith(rows[50]);
  expect(screen.getByRole('button', { name: '19:30, 1 recording, currently in player' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^20:30,/ })).toBeNull();
});

it('trims unrecorded rows around a sparse hour while keeping gaps disabled', () => {
  setup([clip('17:46:00'), clip('17:48:00')]);
  expect(screen.queryByRole('button', { name: '17:00, no footage' })).toBeNull();
  expect((screen.getByRole('button', { name: '17:47, no footage' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '17:48, 1 recording' })).toBeTruthy();
});
