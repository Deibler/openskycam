import { createRef, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Viewer, type ViewerHandle } from '../ui/components/viewer';
import { TooltipProvider } from '../ui/components/ui/tooltip';
import type { Segment } from '../ui/lib/types';

const layout = vi.hoisted(() => ({ compact: false, landscape: false }));
vi.mock('../ui/hooks/use-compact-layout', () => ({
  useCompactLayout: () => layout.compact,
  useLandscapeLayout: () => layout.landscape,
}));
const storage = new Map<string, string>();
const first: Segment = {
  start: '2026-09-22T19:30:00.000Z',
  duration_s: 60,
  size: 1,
  frames: 1800,
  width: 1920,
  height: 1080,
  codec: 'hevc',
  bitrate: null,
};
const second = { ...first, start: '2026-09-22T19:31:00.000Z' };

beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  layout.compact = false;
  layout.landscape = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
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
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
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

function activeLoads(media: HTMLVideoElement) {
  return vi.mocked(HTMLMediaElement.prototype.load).mock.contexts.filter(value => value === media).length;
}
async function presented(media: HTMLVideoElement) {
  await act(async () => {
    fireEvent.seeked(media);
    vi.advanceTimersByTime(40);
  });
}

async function setup(overrides: Partial<ComponentProps<typeof Viewer>> = {}, loaded = true) {
  const handle = createRef<ViewerHandle>();
  let props: ComponentProps<typeof Viewer> = {
    selection: { id: 1, segment: first, offset: 20.25, play: false },
    cam: 'sky01',
    zone: 'UTC',
    day: new Date('2026-09-22T00:00:00Z'),
    segments: [first, second],
    range: null,
    loading: false,
    loadFailed: false,
    active: true,
    previous: false,
    next: true,
    saved: false,
    expanded: false,
    browsing: false,
    onStep: vi.fn(),
    onSeek: vi.fn(),
    onRange: vi.fn(),
    onProgress: vi.fn(),
    onSave: vi.fn(),
    onCopy: vi.fn(),
    onDetails: vi.fn(),
    onExpand: vi.fn(),
    onFindTime: vi.fn(),
    onBrowse: vi.fn(),
    onFullscreenChange: vi.fn(),
    ...overrides,
  };
  const ui = () => (
    <TooltipProvider>
      <Viewer {...props} ref={handle} />
    </TooltipProvider>
  );
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui());
  });
  const media = screen.getByLabelText('Recorded camera footage') as HTMLVideoElement;
  Object.defineProperties(media, {
    duration: { configurable: true, value: 60 },
    readyState: { configurable: true, value: loaded ? 2 : 0 },
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
    currentSrc: { get: () => new URL(media.getAttribute('src') ?? '', location.href).href },
  });
  if (loaded)
    await act(async () => {
      fireEvent.loadedMetadata(media);
      fireEvent.loadedData(media);
    });
  return {
    ...result,
    media,
    handle,
    props,
    async update(next: Partial<ComponentProps<typeof Viewer>>) {
      props = { ...props, ...next };
      await act(async () => result.rerender(ui()));
    },
  };
}

it('accumulates rapid skip taps from the real media time and keeps paused footage loaded', async () => {
  const { media, props } = await setup();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back 5 seconds' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back 5 seconds' })));
  expect(media.currentTime).toBe(15.25); // The first frame must be displayed before the second seek.
  await presented(media);
  expect(media.currentTime).toBe(10.25);
  await presented(media);
  expect(media.paused).toBe(true);
  expect(props.onProgress).toHaveBeenLastCalledWith(first.start, 10.25, true);
  expect(props.onSeek).not.toHaveBeenCalled();
  expect(activeLoads(media)).toBe(1);
  expect(screen.queryByText('Loading recording')).toBeNull();
});

it('keeps playing when skipping and crosses recording boundaries through archive selection', async () => {
  const { media, handle, props } = await setup();
  await act(async () => handle.current!.toggle());
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forward 5 seconds' })));
  expect(media.currentTime).toBe(25.25);
  await presented(media);
  expect(media.paused).toBe(false);
  media.currentTime = 58;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forward 5 seconds' })));
  expect(props.onSeek).toHaveBeenLastCalledWith(new Date('2026-09-22T19:31:03Z'), false);
});

it('retains the frame during a paused seek, with delayed feedback that clears on seeked', async () => {
  const { media, update } = await setup();
  Object.defineProperty(media, 'readyState', { configurable: true, value: 1 });
  await update({ selection: { id: 2, segment: first, offset: 30, play: false } });
  fireEvent.seeking(media);
  fireEvent.waiting(media);
  expect(screen.queryByText('Loading recording')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => vi.advanceTimersByTime(350));
  expect(screen.getByRole('status').textContent?.trim()).toBe('Seeking…');
  expect(document.querySelector('.viewer-empty')).toBeNull();
  Object.defineProperty(media, 'readyState', { configurable: true, value: 2 });
  fireEvent.seeked(media);
  expect(screen.queryByRole('status')).toBeNull();
  expect(media.paused).toBe(true);
  expect(activeLoads(media)).toBe(1);
});

it('does not flash feedback for a seek that finishes quickly', async () => {
  const { media } = await setup();
  fireEvent.seeking(media);
  await act(async () => vi.advanceTimersByTime(100));
  fireEvent.seeked(media);
  await act(async () => vi.advanceTimersByTime(400));
  expect(screen.queryByRole('status')).toBeNull();
});

it('holds the old frame across a file change while retaining zoom and pan', async () => {
  const { media, handle, update } = await setup();
  await act(async () => {
    handle.current!.zoomBy(2);
    handle.current!.panBy(60, 30);
  });
  const transform = media.style.transform;
  await update({ selection: { id: 2, segment: second, offset: 4, play: false } });
  const held = document.querySelector<HTMLCanvasElement>('.video-held-frame')!;
  expect(held.hidden).toBe(false);
  expect(held.style.transform).toBe(transform);
  expect(screen.queryByText('Loading recording')).toBeNull();
  // The held frame looks continuous, so a quick switch shows no notice at all.
  await act(async () => vi.advanceTimersByTime(350));
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => vi.advanceTimersByTime(550));
  expect(screen.getByRole('status').textContent).toContain('Loading 19:31:04');
  fireEvent.loadedMetadata(media);
  fireEvent.loadedData(media);
  expect(held.hidden).toBe(true);
  expect(media.style.transform).toBe(transform);
  expect(screen.queryByRole('status')).toBeNull();
});

it('updates a pending same-file seek without restarting its download', async () => {
  const { media, update } = await setup({}, false);
  await update({ selection: { id: 2, segment: first, offset: 32.1, play: false } });
  expect(activeLoads(media)).toBe(1);
  Object.defineProperty(media, 'readyState', { configurable: true, value: 2 });
  fireEvent.loadedMetadata(media);
  fireEvent.loadedData(media);
  expect(media.currentTime).toBe(32.1);
  expect(screen.queryByText('Loading recording')).toBeNull();
});

it('repeats a short section without reloading, advancing files, or resetting zoom', async () => {
  const { media, handle, props } = await setup();
  await act(async () => {
    handle.current!.zoomBy(2);
    handle.current!.panBy(50, 25);
  });
  const transform = media.style.transform;
  await act(async () => handle.current!.toggleLoop());
  expect(media.currentTime).toBe(15.25);
  expect(media.paused).toBe(false);
  media.currentTime = 20.3;
  fireEvent.timeUpdate(media);
  expect(media.currentTime).toBe(15.25);
  expect(media.style.transform).toBe(transform);
  expect(screen.getByRole('slider').getAttribute('aria-label')).toBe('Seek recordings, replay loop view');
  expect(props.onStep).not.toHaveBeenCalled();
  expect(activeLoads(media)).toBe(1);
  await act(async () => handle.current!.toggleLoop());
  expect(screen.queryByLabelText('Timeline scale, replay loop')).toBeNull();
});

it('marks start and end at precise media positions and stops looping when seeking outside', async () => {
  const { media, handle } = await setup();
  media.currentTime = 8.1;
  await act(async () => handle.current!.markLoop('from'));
  media.currentTime = 10.6;
  await act(async () => handle.current!.markLoop('to'));
  expect(media.currentTime).toBe(8.1);
  media.currentTime = 10.6;
  fireEvent.timeUpdate(media);
  expect(media.currentTime).toBe(8.1);
  await act(async () => handle.current!.seekBy(-5));
  expect(media.currentTime).toBeCloseTo(3.1);
  expect(screen.queryByLabelText('Timeline scale, replay loop')).toBeNull();
});

it('clamps replay to an applied time range and clears the loop on another recording', async () => {
  const { media, handle, update } = await setup({
    range: { from: Date.parse(first.start) + 10000, to: Date.parse(first.start) + 23000 },
  });
  media.currentTime = 12;
  await act(async () => handle.current!.toggleLoop());
  expect(media.currentTime).toBe(10);
  await update({ selection: { id: 2, segment: second, offset: 0, play: false }, range: null, next: false });
  expect(screen.queryByLabelText('Timeline scale, replay loop')).toBeNull();
});

it('uses the chosen skip interval for buttons and keyboard commands, and remembers it', async () => {
  const { handle, media, unmount } = await setup();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Replay and skip settings' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '10s' })));
  expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeTruthy();
  await act(async () => handle.current!.skip(-1));
  expect(media.currentTime).toBe(10.25);
  await presented(media);
  unmount();
  await setup();
  expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeTruthy();
});

it('keeps the same loaded, enlarged recording when rotating a phone and exposes landscape browsing', async () => {
  layout.compact = true;
  const onBrowse = vi.fn();
  const { media, handle, update } = await setup({ onBrowse });
  await act(async () => {
    handle.current!.zoomBy(1);
    handle.current!.panBy(30, 20);
  });
  const transform = media.style.transform;
  layout.landscape = true;
  await update({});
  expect(screen.getByLabelText('Recorded camera footage')).toBe(media);
  expect(media.currentTime).toBe(20.25);
  expect(media.paused).toBe(true);
  expect(media.style.transform).toBe(transform);
  expect(screen.getByRole('region', { name: 'Recording player' }).hasAttribute('data-landscape')).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browse footage' })));
  expect(onBrowse).toHaveBeenCalledOnce();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Minimize playback controls' })));
  expect(screen.getByRole('group', { name: 'Minimized playback controls' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back 5 seconds' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Browse footage' })).toBeTruthy();
  layout.landscape = false;
  await update({});
  expect(media.style.transform).toBe(transform);
  expect(activeLoads(media)).toBe(1);
});

it('keeps replay settings open when the mobile More menu returns focus', async () => {
  layout.compact = true;
  await setup();
  await act(async () =>
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'More recording options' })[1], { key: 'ArrowDown' }),
  );
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Replay and skip settings' })));
  await act(async () => vi.advanceTimersByTime(100));
  expect(screen.getByRole('dialog', { name: 'Replay and skip settings' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Loop last 5s' })));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Timeline scale, replay loop')).toBeTruthy();
});

it('opens landscape options and switches to replay without losing the video or closing the new panel', async () => {
  layout.compact = true;
  layout.landscape = true;
  const { media } = await setup();
  await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'More recording options' })[1]));
  expect(screen.getByRole('dialog', { name: 'Options' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Replay and skip', exact: true })));
  await act(async () => vi.advanceTimersByTime(100));
  expect(screen.getByRole('dialog', { name: 'Replay and skip settings' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Loop last 5s' })));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Recorded camera footage')).toBe(media);
  expect(media.currentTime).toBe(15.25);
  expect(media.paused).toBe(false);
  expect(activeLoads(media)).toBe(1);
});

it('displays every rapid tap even when a paused decoder never delivers its frame callback', async () => {
  const { media, handle } = await setup({ selection: { id: 1, segment: first, offset: 45.25, play: false } });
  Object.defineProperties(media, {
    requestVideoFrameCallback: { value: vi.fn(() => 1), configurable: true },
    cancelVideoFrameCallback: { value: vi.fn(), configurable: true },
  });
  await act(async () => {
    for (let tap = 0; tap < 8; tap++) handle.current!.skip(-1);
  });
  // No intermediate frame is coalesced away, and waiting for a callback can't stall later taps.
  for (const offset of [40.25, 35.25, 30.25, 25.25, 20.25, 15.25, 10.25, 5.25]) {
    expect(media.currentTime).toBe(offset);
    await presented(media);
  }
  await act(async () => handle.current!.skip(1));
  expect(media.currentTime).toBe(10.25);
  await presented(media);
  expect(media.paused).toBe(true);
  expect(activeLoads(media)).toBe(1);
});

it('promotes a prepared next clip without reloading it or resetting zoom', async () => {
  const { media, handle, update } = await setup();
  const prepared = document.querySelector<HTMLVideoElement>('video.video-standby')!;
  expect(prepared.getAttribute('src')).toContain('20260922T193100Z');
  Object.defineProperties(prepared, {
    readyState: { configurable: true, value: 2 },
    duration: { configurable: true, value: 60 },
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
    currentSrc: { get: () => new URL(prepared.getAttribute('src') ?? '', location.href).href },
  });
  await act(async () => {
    fireEvent.loadedMetadata(prepared);
    fireEvent.loadedData(prepared);
    handle.current!.zoomBy(2);
  });
  expect(activeLoads(prepared)).toBe(1);
  const transform = media.style.transform;
  await update({ selection: { id: 2, segment: second, offset: 0, play: true }, previous: true, next: false });
  expect(screen.getByLabelText('Recorded camera footage')).toBe(prepared);
  expect(prepared.paused).toBe(false);
  expect(prepared.style.transform).toBe(transform);
  expect(activeLoads(prepared)).toBe(1);
  expect(document.querySelector<HTMLCanvasElement>('.video-held-frame')!.hidden).toBe(true);
  expect(screen.queryByText('Loading recording')).toBeNull();
  // Old decoder events must not stop the new player or show an error.
  await act(async () => {
    fireEvent.pause(media);
    fireEvent.error(media);
  });
  expect(screen.queryByText('Preview unavailable')).toBeNull();
  expect(screen.getByRole('button', { name: 'Pause recording' })).toBeTruthy();
});

it('cancels queued steps when the viewer deliberately chooses another point', async () => {
  const { media, handle, update } = await setup();
  await act(async () => {
    handle.current!.skip(-1);
    handle.current!.skip(-1);
  });
  await update({ selection: { id: 2, segment: first, offset: 40, play: false } });
  await presented(media);
  expect(media.currentTime).toBe(40);
  await act(async () => handle.current!.skip(-1));
  expect(media.currentTime).toBe(35);
});
