import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Viewer, type ViewerHandle } from '../ui/components/viewer';
import { TooltipProvider } from '../ui/components/ui/tooltip';
import type { Segment } from '../ui/lib/types';

// --- The player at fast speeds ---
const memory = vi.hoisted(() => new Map<string, { url: string; keyframes: number[] }>());
vi.mock('../ui/lib/clip-cache', async original => ({
  ...(await original<typeof import('../ui/lib/clip-cache')>()),
  cachedClip: (src: string) => memory.get(src) ?? null,
  keepClips: vi.fn(),
}));
vi.mock('../ui/hooks/use-compact-layout', () => ({ useCompactLayout: () => false, useLandscapeLayout: () => false }));
const day: Segment = {
  start: '2026-09-22T19:30:00.000Z',
  duration_s: 60,
  size: 1,
  frames: 1800,
  width: 3840,
  height: 2160,
  codec: 'hevc',
  bitrate: null,
};
const second = { ...day, start: '2026-09-22T19:31:00.000Z' };
const keyframes = Array.from({ length: 60 }, (_, i) => i + 0.014);

beforeEach(() => {
  memory.clear();
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'Date',
    ],
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    top: 0,
    right: 600,
    bottom: 400,
    left: 0,
    toJSON() {},
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
});
afterEach(async () => {
  await act(async () => cleanup());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function player(segment: Segment) {
  const handle = createRef<ViewerHandle>(),
    noop = vi.fn();
  await act(async () => {
    render(
      <TooltipProvider>
        <Viewer
          ref={handle}
          selection={{ id: 1, segment, offset: 10, play: false }}
          cam="sky01"
          zone="UTC"
          day={new Date('2026-09-22T00:00:00Z')}
          segments={[segment, second]}
          range={null}
          loading={false}
          loadFailed={false}
          active
          previous={false}
          next
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
  });
  const media = screen.getByLabelText('Recorded camera footage') as HTMLVideoElement;
  Object.defineProperties(media, {
    duration: { configurable: true, value: 60 },
    readyState: { configurable: true, value: 2 },
    videoWidth: { value: 3840 },
    videoHeight: { value: 2160 },
    currentSrc: { get: () => media.getAttribute('src') ?? '' },
  });
  await act(async () => {
    fireEvent.loadedMetadata(media);
    fireEvent.loadedData(media);
  });
  return { media, handle };
}
// Fake timers stop testing-library's polling, so menus are opened and read synchronously.
async function openSpeeds() {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('button', { name: /Playback speed/ }), { key: 'ArrowDown' });
  });
  return screen.getAllByRole('menuitemradio');
}
async function chooseSpeed(value: string) {
  const item = (await openSpeeds()).find(i => i.textContent === `${value}×`)!;
  await act(async () => {
    fireEvent.click(item);
  });
}
const run = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

it('offers 8× and 16×', async () => {
  await player(day);
  const speeds = (await openSpeeds()).map(item => item.textContent);
  expect(speeds.slice(-2)).toEqual(['8×', '16×']);
});

it('steps 4K daytime video through its keyframes at a true 16× instead of stalling the decoder', async () => {
  memory.set('/api/video/sky01/20260922T193000Z', { url: 'blob:day', keyframes });
  const { media, handle } = await player(day);
  await chooseSpeed('16');
  await act(async () => handle.current!.toggle());
  expect(media.playbackRate).toBe(1); // 30 fps × 16 = 480 decoded frames a second is more than the decoder has
  await run(100); // the clock passes the next keyframe after ~63 ms
  expect(media.currentTime).toBe(11.014);
  await run(400); // one seek at a time: a slow decoder shows fewer frames, the clock never waits
  expect(media.currentTime).toBe(11.014);
  await act(async () => fireEvent.seeked(media));
  await run(20); // 520 ms at 16× is 8.3 media seconds: jump to the latest keyframe passed
  expect(media.currentTime).toBe(18.014);
  expect(screen.queryByRole('status')).toBeNull();
  // A seek by the viewer restarts the clock from where they landed.
  media.currentTime = 5;
  await act(async () => fireEvent.seeked(media));
  await run(100); // without re-anchoring, the old clock would jump it to ~26
  expect(media.currentTime).toBe(6.014);
});

it('plays low-frame-rate night footage natively at 16×, where the decoder keeps up', async () => {
  const { media, handle } = await player({ ...day, frames: 480 }); // 8 fps × 16 = 128 frames a second
  await chooseSpeed('16');
  await act(async () => handle.current!.toggle());
  expect(media.playbackRate).toBe(16);
  await run(500);
  expect(media.currentTime).toBe(10);
});

it('prepares the next clip from its in-memory copy, so the switch never waits on the network', async () => {
  memory.set('/api/video/sky01/20260922T193100Z', { url: 'blob:next', keyframes });
  await player(day);
  const standby = document.querySelector<HTMLVideoElement>('video.video-standby')!;
  expect(standby.getAttribute('src')).toBe('blob:next');
  expect(standby.dataset.clip).toBe('/api/video/sky01/20260922T193100Z');
});
