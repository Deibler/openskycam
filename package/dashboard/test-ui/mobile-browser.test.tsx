import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileRecordingSheet } from '../ui/components/mobile-recording-sheet';
import { RecordingBrowser } from '../ui/components/recording-browser';
import { TooltipProvider } from '../ui/components/ui/tooltip';
import type { Segment } from '../ui/lib/types';

const clip = (hour: string): Segment => ({
  start: `2026-09-22T${hour}:30:00.000Z`,
  duration_s: 60,
  size: 1,
  frames: null,
  width: null,
  height: null,
  codec: null,
  bitrate: null,
});
const segments = [clip('18'), clip('19')];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fullscreenElement');
});

it('lets a phone user browse hours before choosing a clip, then returns focus to the player page', async () => {
  const choose = vi.fn();
  function Review() {
    const [open, setOpen] = useState(false);
    const search = useRef<HTMLInputElement>(null);
    return (
      <TooltipProvider>
        <MobileRecordingSheet
          availability={{ days: new Set(['2026-09-22']), loading: false, error: null, retry: vi.fn() }}
          open={open}
          onOpenChange={setOpen}
          day={new Date('2026-09-22T00:00:00Z')}
          dayKey="2026-09-22"
          zone="UTC"
          count={2}
          onDate={vi.fn()}
          onZone={vi.fn()}
        >
          <RecordingBrowser
            browseOnly
            dayKey="2026-09-22"
            zone="UTC"
            cam="sky01"
            segments={segments}
            selected={segments[0]}
            playhead={Date.parse(segments[0].start)}
            loading={false}
            saved={new Set()}
            range={null}
            searchRef={search}
            onSelect={segment => {
              choose(segment);
              setOpen(false);
            }}
            onSeek={vi.fn()}
            onRange={vi.fn()}
            notify={vi.fn()}
          />
        </MobileRecordingSheet>
      </TooltipProvider>
    );
  }
  render(<Review />);
  const trigger = screen.getByRole('button', { name: /Browse recordings/ });
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeTruthy();
  // Opening the sheet must not summon the phone keyboard.
  expect(document.activeElement).toBe(screen.getByRole('dialog').querySelector('[data-slot=dialog-title]'));
  fireEvent.click(screen.getByRole('button', { name: 'Browse 19:00 – 20:00' }));
  expect(choose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '19:30, 1 recording' }));
  expect(choose).toHaveBeenCalledWith(segments[1]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('browses and selects an exact second inside fullscreen, then returns focus without exiting', async () => {
  const host = document.createElement('section');
  document.body.append(host);
  vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(host);
  const seek = vi.fn();
  const select = vi.fn();
  function FullscreenReview() {
    const [open, setOpen] = useState(false);
    const search = useRef<HTMLInputElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    return (
      <TooltipProvider>
        <button ref={trigger} onClick={() => setOpen(true)}>
          Browse footage
        </button>
        <MobileRecordingSheet
          availability={{ days: new Set(['2026-09-22']), loading: false, error: null, retry: vi.fn() }}
          fullscreen
          returnFocus={trigger}
          open={open}
          onOpenChange={setOpen}
          day={new Date('2026-09-22T00:00:00Z')}
          dayKey="2026-09-22"
          zone="UTC"
          count={2}
          onDate={vi.fn()}
          onZone={vi.fn()}
        >
          <RecordingBrowser
            browseOnly
            dayKey="2026-09-22"
            zone="UTC"
            cam="sky01"
            segments={segments}
            selected={segments[0]}
            playhead={Date.parse(segments[0].start)}
            loading={false}
            saved={new Set()}
            range={null}
            searchRef={search}
            onSelect={select}
            onSeek={date => {
              seek(date);
              setOpen(false);
            }}
            onRange={vi.fn()}
            notify={vi.fn()}
          />
        </MobileRecordingSheet>
      </TooltipProvider>
    );
  }
  render(<FullscreenReview />, { container: host });
  const trigger = screen.getByRole('button', { name: 'Browse footage' });
  fireEvent.click(trigger);
  expect(host.contains(screen.getByRole('dialog'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Browse 19:00 – 20:00' }));
  expect(select).not.toHaveBeenCalled();
  expect(seek).not.toHaveBeenCalled();
  const input = screen.getByRole('textbox', { name: 'Go to time' });
  fireEvent.change(input, { target: { value: '193025' } });
  fireEvent.submit(input.closest('form')!);
  expect(seek).toHaveBeenCalledWith(new Date('2026-09-22T19:30:25.000Z'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.fullscreenElement).toBe(host);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
