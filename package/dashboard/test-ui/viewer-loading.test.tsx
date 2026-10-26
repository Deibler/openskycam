import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Viewer } from '../ui/components/viewer';
import { TooltipProvider } from '../ui/components/ui/tooltip';
import type { Segment } from '../ui/lib/types';

vi.mock('../ui/hooks/use-compact-layout', () => ({ useCompactLayout: () => false, useLandscapeLayout: () => false }));
vi.mock('../ui/hooks/use-video-viewport', () => ({
  useVideoViewport: () => ({ zoom: 1, pan: { x: 0, y: 0 }, zoomTo: vi.fn(), reset: vi.fn(), panBy: vi.fn() }),
}));
vi.mock('../ui/hooks/use-player-controls', () => ({
  usePlayerControls: () => ({ minimized: false, positionStyle: {}, activity: vi.fn() }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders one indicator during initial loading and one during subsequent buffering', () => {
  const segment: Segment = {
    start: '2026-09-22T19:30:00.000Z',
    duration_s: 60,
    size: 1,
    frames: null,
    width: null,
    height: null,
    codec: null,
    bitrate: null,
  };
  const noop = vi.fn();
  render(
    <TooltipProvider>
      <Viewer
        selection={{ id: 1, segment, offset: 0, play: true }}
        cam="sky01"
        zone="UTC"
        day={new Date('2026-09-22T00:00:00Z')}
        segments={[segment]}
        range={null}
        loading={false}
        loadFailed={false}
        active
        previous={false}
        next={false}
        saved={false}
        expanded={false}
        browsing={false}
        onStep={noop}
        onSeek={noop}
        onRange={noop}
        onProgress={noop}
        onSave={noop}
        onCopy={noop}
        onDetails={noop}
        onExpand={noop}
        onFindTime={noop}
        onBrowse={noop}
        onFullscreenChange={noop}
      />
    </TooltipProvider>,
  );
  const media = screen.getByLabelText('Recorded camera footage');
  fireEvent.play(media);
  fireEvent.waiting(media);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent?.trim()).toBe('Loading recording');
  // A decorative brand mark accompanies the single spoken status.
  expect(screen.getByRole('status').querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  fireEvent.loadedData(media);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(350));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent?.trim()).toBe('Buffering…');
  expect(screen.getByRole('status').querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  fireEvent.playing(media);
  expect(screen.queryByRole('status')).toBeNull();
});
