import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { RunReview } from '../ui/features/workshop/components/run-review';
import { BucketExplorer } from '../ui/features/workshop/components/bucket-explorer';
import { TooltipProvider } from '../ui/components/ui/tooltip';
import {
  batchSightings,
  boxAt,
  decidedLabels,
  groupSightings,
  nextPending,
  overlapped,
  sightingClip,
} from '../ui/features/workshop/utils/sightingInferenceUtil';
import { keepClips } from '../ui/lib/clip-cache';
import { useSnapScroll } from '../ui/features/workshop/hooks/use-snap-scroll';
import { clampCamera, focusCamera, zoomCamera } from '../ui/features/workshop/utils/reviewCameraInferenceUtil';
import { dragBox } from '../ui/features/workshop/utils/reviewGeometryInferenceUtil';
import type { WorkshopRunImage, WorkshopRunReview } from '../src/models/workshopInferencemodel';

const cache = vi.hoisted(() => ({
  part: null as { url: string; keyframes: number[]; offset: number } | null,
  loading: false,
}));
vi.mock('../ui/lib/clip-cache', async original => ({
  ...(await original<typeof import('../ui/lib/clip-cache')>()),
  cachedClip: () => cache.part,
  loadingClip: () => cache.loading,
  keepClips: vi.fn(),
}));
const key = (k: string, options = {}) =>
  act(async () => {
    fireEvent.keyDown(window, { key: k, ...options });
  });
const frame = (
  id: string,
  second: number,
  bucket = 'planes',
  className = 'Plane',
  review: WorkshopRunImage['review'] = 'pending',
): WorkshopRunImage => ({
  id,
  bucket_id: bucket,
  asset_id: id,
  run_id: 'run',
  job_id: 'job',
  source_sha256: 's',
  cam: 'sky01',
  captured_at: new Date(Date.UTC(2026, 8, 25, 8, 3, second)).toISOString(),
  object_key: 'k',
  sha256: 'h',
  expires_at: '2026-10-25T00:00:00.000Z',
  review,
  created_at: '2026-09-25T08:05:00.000Z',
  image_url: `/api/workshop/items/${id}/image`,
  annotation_json: JSON.stringify([
    { box: [0.4, 0.2, 0.45, 0.25], class_id: 0, class_name: className, confidence: 0.6, model_node: 'model' },
  ]),
  provenance_json: JSON.stringify({
    width: 3840,
    height: 2160,
    annotation_model: {
      node_id: 'model',
      task: 'object-detection',
      classes: [
        { id: 0, name: 'Plane' },
        { id: 1, name: 'Meteorite' },
      ],
    },
    source: { cam: 'sky01', start: '2026-09-25T08:03:02.000Z', duration_s: 60, width: 3840, height: 2160 },
  }),
});

it('groups consecutive frames of one object into a sighting, split by gap, bucket, and class', () => {
  const items = [
    frame('d', 53),
    frame('b', 44),
    frame('a', 40),
    frame('e', 45, 'meteors', 'Meteorite'),
    frame('c', 47),
  ];
  expect(groupSightings(items).map(s => s.frames.map(f => f.id))).toEqual([['a', 'b', 'c'], ['e'], ['d']]);
});
it('keeps objects of one class in different spots apart, and follows one that moves a few of its widths', () => {
  const boxed = (f: WorkshopRunImage, box: number[]) => ({
    ...f,
    annotation_json: JSON.stringify([{ box, class_id: 0, class_name: 'Plane', confidence: 0.6, model_node: 'model' }]),
  });
  const items = [
    frame('a', 40),
    boxed(frame('b', 41), [0.8, 0.6, 0.85, 0.65]),
    boxed(frame('c', 42), [0.5, 0.2, 0.55, 0.25]),
    boxed(frame('d', 43), [0.82, 0.6, 0.87, 0.65]),
    boxed(frame('e', 44), [0.1, 0.8, 0.15, 0.85]),
  ];
  expect(groupSightings(items).map(s => s.frames.map(f => f.id))).toEqual([['a', 'c'], ['b', 'd'], ['e']]);
});
it('moves on to the next sighting still to review, never the current one', () => {
  const [one, two, three] = groupSightings([frame('a', 0, 'x', 'Plane', 'accepted'), frame('b', 20), frame('c', 40)]);
  expect(nextPending([one, two, three], 1)).toBe(2);
  expect(nextPending([one, two, three], 2)).toBe(1);
  expect(nextPending([one, two], 1)).toBe(-1);
  expect(nextPending([one, two, three], -1)).toBe(1);
});
// --- Reviewing a run ---
const review: WorkshopRunReview = {
  run: {
    id: 'run',
    name: 'Night planes',
    workflow_id: 'flow',
    mode: 'run',
    created_at: '2026-09-25T08:15:00.000Z',
    output_buckets: ['planes'],
  },
  recordings: [
    {
      cam: 'sky01',
      start: '2026-09-25T08:03:02.000Z',
      size: 1,
      duration_s: 60,
      frames: 1800,
      width: 3840,
      height: 2160,
      bitrate: null,
      codec: 'hevc',
    },
  ],
  classes: [
    {
      node_id: 'model',
      classes: [
        { id: 0, name: 'Plane' },
        { id: 1, name: 'Meteorite' },
      ],
    },
  ],
  items: [frame('a', 40), frame('b', 42), frame('c', 55)],
  has_more: false,
};
let failSave = false,
  saved = new Set<string>(),
  browsed: URLSearchParams[] = [];
let workflowRuns = [
    { id: 'run', pending: 0 },
    { id: 'older', pending: 4 },
  ],
  pendingByWorkflow: { workflow_id: string; pending: number }[] = [];
let puts: { id: string; body: { review: string; annotations?: { class_name: string }[] } }[] = [];
beforeEach(() => {
  puts = [];
  failSave = false;
  saved = new Set();
  browsed = [];
  workflowRuns = [
    { id: 'run', pending: 0 },
    { id: 'older', pending: 4 },
  ];
  pendingByWorkflow = [];
  cache.part = null;
  cache.loading = false;
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
    width: 640,
    height: 360,
    top: 0,
    right: 640,
    bottom: 360,
    left: 0,
    toJSON() {},
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      if (path === '/api/workshop/runs/run/review') return json(review);
      if (path === '/api/workshop/runs?workflow=flow') return json({ runs: workflowRuns });
      if (path === '/api/workshop/summary') return json({ buckets: [], workflows: pendingByWorkflow });
      if (path.includes('/browse?')) {
        browsed.push(new URLSearchParams(path.split('?')[1]));
        return json({
          items: review.items,
          total: 3,
          cursor: null,
          facets: {
            runs: [{ id: 'run', name: 'Night planes', created_at: review.run.created_at, images: 3 }],
            cameras: ['sky01'],
            classes: ['Plane', 'Meteorite'],
          },
        });
      }
      const id = decodeURIComponent(path.split('/')[4]);
      if (path.endsWith('/save')) {
        saved.add(id);
        return json({ saved: true });
      }
      const stored = (item?: WorkshopRunImage) =>
        item && (saved.has(item.id) ? { ...item, object_key: `retained/${item.id}` } : item);
      if (!init?.body)
        return json({
          item: stored(review.items.find(i => i.id === id)),
          recording: review.recordings[0],
          run: review.run,
          classes: review.classes[0].classes,
        });
      const body = JSON.parse(String(init.body));
      puts.push({ id, body });
      if (failSave)
        return new Response(JSON.stringify({ error: 'Save interrupted. Try again.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      return json({
        review: body.review,
        ...(body.annotations ? { annotations: body.annotations.map((a: object) => ({ ...a, edited: true })) } : {}),
      });
    }),
  );
});
afterEach(async () => {
  await act(async () => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --- A bucket: a grid of sightings that opens a feed ---
const openBucket = async (itemId = '', onItem = vi.fn()) => {
  render(
    <TooltipProvider>
      <BucketExplorer bucketId="planes" title="Night planes" initialRun="run" itemId={itemId} onItem={onItem} />
    </TooltipProvider>,
  );
  return screen.findByRole('button', { name: /^Plane, .*, 2 photos$/ });
};
it('asks before Back from a bucket feed drops marks that are not saved yet', async () => {
  const onLeave = vi.fn();
  render(
    <TooltipProvider>
      <BucketExplorer bucketId="planes" title="Night planes" initialRun="run" onItem={vi.fn()} onLeave={onLeave} />
    </TooltipProvider>,
  );
  const sighting = await screen.findByRole('button', { name: /^Plane, .*, 2 photos$/ });
  await act(async () => {
    fireEvent.click(sighting);
  });
  await screen.findByRole('article', { name: /Sighting 1 of 2/ });
  await key('2'); // Meteorite, staged until Enter
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Back to bucket' }));
  });
  expect(onLeave).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('article', { name: /Sighting 1 of 2/ })).toBeTruthy();
  expect(puts).toEqual([]);
});
const tile = (photos: 1 | 2) =>
  screen.getByRole('button', { name: new RegExp(`^Plane, .*, ${photos} ${photos === 1 ? 'photo' : 'photos'}`) });
const feedCard = (n: number) => screen.getByRole('article', { name: `Sighting ${n} of 2: Plane` });

it('bucket page: shows sightings newest first as tiles, and a tile opens the feed there with its clip', async () => {
  const onItem = vi.fn();
  await openBucket('', onItem);
  const tiles = screen.getAllByRole('button', { name: /^Plane, / });
  expect(tiles.map(t => t.getAttribute('data-sighting'))).toEqual(['c', 'a']);
  expect(tile(2).querySelector('img')?.getAttribute('src')).toContain('mode=object');
  fireEvent.click(tile(2));
  expect(onItem).toHaveBeenCalledWith('a', true);
  const card = feedCard(2);
  expect(card.getAttribute('data-current')).toBe('true');
  await waitFor(() =>
    expect(within(card).getByLabelText('Sighting video').getAttribute('src')).toBe(
      '/api/video/sky01/20260925T080302Z#t=37',
    ),
  );
  // The clip comes from the photo's own provenance: no round trip per sighting before it can load.
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([path, init]) => /^\/api\/workshop\/items\/[^/]+$/.test(String(path)) && !init?.body),
  ).toEqual([]);
  const video = within(card).getByLabelText<HTMLVideoElement>('Sighting video');
  fireEvent.loadedMetadata(video);
  expect(video.playbackRate).toBe(1);
  fireEvent.click(within(card).getByRole('button', { name: 'Playback speed, 1 times' }));
  expect(video.playbackRate).toBe(2);
  fireEvent.click(within(card).getByRole('button', { name: 'Playback speed, 2 times' }));
  expect(video.playbackRate).toBe(4);
  expect(within(card).getByText('Night planes')).toBeTruthy();
  await act(async () => {
    fireEvent.click(within(card).getByRole('button', { name: 'Next page' }));
  });
  expect(within(card).queryByRole('button', { name: /^Playback speed/ })).toBeNull();
});
it("bucket page: plays the sighting's seconds from memory, waiting while they download, and fetches them ahead", async () => {
  cache.loading = true;
  fireEvent.click(await openBucket());
  const card = feedCard(2),
    video = await within(card).findByLabelText('Sighting video');
  expect(video.getAttribute('src')).toBeNull();
  expect(vi.mocked(keepClips).mock.calls.at(-1)![0]).toEqual(['/api/video/sky01/20260925T080302Z#t=37,41']);
  cache.loading = false;
  cache.part = { url: 'blob:part', keyframes: [0], offset: 36 };
  await act(async () => vi.mocked(keepClips).mock.calls.at(-1)![2]());
  expect(video.getAttribute('src')).toBe('blob:part#t=1');
});
it('bucket page: a pinch looks closer with a map of the frame, a drag then pans, and the map button goes back', async () => {
  fireEvent.click(await openBucket());
  const card = feedCard(2);
  await act(async () => {
    fireEvent.click(within(card).getByRole('button', { name: 'Next page' }));
  });
  const stage = within(card)
    .getAllByRole('img', { name: /^Camera frame at/ })[0]
    .closest<HTMLElement>('.wk-stage')!;
  const layer = () => stage.querySelector<HTMLElement>('.wk-stage-layer')!.style.transform,
    framed = layer();
  const drag = (id: number, [x, y]: number[], [toX, toY]: number[]) => {
    fireEvent.pointerDown(stage, { pointerId: id, clientX: x, clientY: y });
    fireEvent.pointerMove(stage, { pointerId: id, clientX: toX, clientY: toY });
    fireEvent.pointerUp(stage, { pointerId: id });
  };
  drag(1, [300, 200], [300, 100]);
  expect(layer()).toBe(framed);
  fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 180 });
  drag(2, [340, 180], [380, 180]);
  fireEvent.pointerUp(stage, { pointerId: 1 });
  expect(stage.hasAttribute('data-looking')).toBe(true);
  const closer = layer();
  expect(closer).not.toBe(framed);
  drag(3, [300, 180], [280, 170]);
  expect(layer()).not.toBe(closer);
  const back = within(stage).getByRole('button', { name: 'Back to the framed view' });
  fireEvent.pointerDown(back, { pointerId: 4 });
  fireEvent.pointerUp(back, { pointerId: 4 });
  fireEvent.click(back);
  expect(stage.hasAttribute('data-looking')).toBe(false);
  expect(layer()).toBe(framed);
});
it('keeps showing its page when pages are added in front, instead of reporting a swipe', () => {
  const onIndex = vi.fn();
  function Pager({ layout }: { layout: number }) {
    const [ref, onScroll] = useSnapScroll('x', 0, onIndex, layout);
    return <div ref={ref} onScroll={onScroll} data-testid="pager" />;
  }
  const { rerender } = render(<Pager layout={0} />);
  const pager = screen.getByTestId('pager');
  Object.defineProperty(pager, 'clientWidth', { value: 100 });
  Object.defineProperty(pager, 'scrollLeft', { writable: true, value: 100 });
  pager.scrollTo = vi.fn(({ left }: ScrollToOptions) => {
    pager.scrollLeft = left!;
  }) as typeof pager.scrollTo;
  // The browser keeps the page that was showing snapped, now one further along.
  rerender(<Pager layout={1} />);
  fireEvent.scroll(pager);
  expect(pager.scrollLeft).toBe(0);
  expect(onIndex).not.toHaveBeenCalled();
});
it('bucket page: Confirm in the feed decides the sighting, label edits save without deciding, and the grid shows both after Back', async () => {
  const onItem = vi.fn();
  await openBucket('', onItem);
  fireEvent.click(tile(2));
  const card = feedCard(2);
  await act(async () => {
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
  });
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
  ]);
  puts = [];
  await key('ArrowUp');
  fireEvent.click(within(card).getByRole('button', { name: 'Edit labels' }));
  const editor = within(screen.getByRole('dialog', { name: 'Edit labels' }));
  await key('2');
  await act(async () => {
    fireEvent.click(editor.getByRole('button', { name: 'Done' }));
  });
  expect(puts).toEqual([
    { id: 'a', body: { review: 'accepted', annotations: [expect.objectContaining({ class_name: 'Meteorite' })] } },
  ]);
  // Opening from the grid was a visit, so closing goes back rather than adding another page.
  const back = vi.spyOn(history, 'back').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Back to bucket' }));
  expect(screen.queryByRole('feed')).toBeNull();
  expect(back).toHaveBeenCalledOnce();
  expect(onItem).not.toHaveBeenCalledWith('');
  // The tile names the sighting by its saved label, not the one it was found as.
  expect(screen.getByRole('button', { name: /^Meteorite, .*, 2 photos, Yes$/ })).toBeTruthy();
});
it('bucket page: a link opens the feed on its photo, the editor asks before discarding, and closing drops the link', async () => {
  const onItem = vi.fn();
  await openBucket('c', onItem);
  await waitFor(() => expect(feedCard(1).getAttribute('data-current')).toBe('true'));
  fireEvent.click(within(feedCard(1)).getByRole('button', { name: 'Edit labels' }));
  const editor = within(screen.getByRole('dialog', { name: 'Edit labels' }));
  await key('2');
  fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(editor.getByRole('button', { name: /Meteorite\s*Edited/ })).toBeTruthy();
  fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(puts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Back to bucket' }));
  expect(onItem).toHaveBeenLastCalledWith('');
  expect(screen.queryByRole('feed')).toBeNull();
});
it('bucket page: keeps failed label edits in the editor for retry, without changing review status', async () => {
  await openBucket('c');
  fireEvent.click(within(feedCard(1)).getByRole('button', { name: 'Edit labels' }));
  const editor = within(screen.getByRole('dialog', { name: 'Edit labels' }));
  await key('2');
  failSave = true;
  await act(async () => {
    fireEvent.click(editor.getByRole('button', { name: 'Done' }));
  });
  expect(editor.getByRole('alert').textContent).toContain('Save interrupted. Try again.');
  expect(editor.getByRole('button', { name: /Meteorite\s*Edited/ })).toBeTruthy();
  failSave = false;
  await act(async () => {
    fireEvent.click(editor.getByRole('button', { name: 'Done' }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(puts.map(p => p.body.review)).toEqual(['pending', 'pending']);
});
it('bucket page: saves a sighting from the feed and shows it saved from the server', async () => {
  await openBucket('a');
  const card = feedCard(2);
  fireEvent.click(within(card).getByRole('button', { name: 'Save images beyond expiration' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save images and labels' }));
  });
  expect([...saved]).toEqual(['a', 'b']);
  await waitFor(() =>
    expect(within(card).getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')).toBe('true'),
  );
});
it('bucket page: filters by status and day on the server, and selected tiles decide all their photos', async () => {
  const first = review.items[0],
    before = first.annotation_json,
    labels = JSON.parse(before);
  first.annotation_json = JSON.stringify([...labels, { ...labels[0], box: [0.38, 0.18, 0.47, 0.27], confidence: 0.3 }]);
  onTestFinished(() => {
    first.annotation_json = before;
  });
  await openBucket();
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'pending' } });
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-09-25' } });
  await waitFor(() => expect(browsed.at(-1)?.get('review')).toBe('pending'));
  const query = browsed.at(-1)!;
  expect(Date.parse(query.get('to')!) - Date.parse(query.get('from')!)).toBe(86400000);
  expect(new Date(query.get('from')!).getHours()).toBe(0);
  await screen.findByRole('button', { name: /^Plane, .*, 2 photos$/ });
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(tile(2));
  expect(tile(2).getAttribute('aria-pressed')).toBe('true');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected images' }));
  });
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
  ]);
  expect(puts.find(p => p.id === 'a')?.body.annotations).toHaveLength(1);
  expect(screen.queryByRole('toolbar', { name: 'Selected photos' })).toBeNull();
  expect(tile(2).getAttribute('aria-label')).toMatch(/, Yes$/);
});

// --- The run reviewer: a feed of sightings ---
const buckets = [{ id: 'planes', name: 'Night planes', kind: 'labeled' as const, description: '', createdAt: null }];
const openReviewer = async (onItem = vi.fn()) => {
  render(
    <RunReview
      runId="run"
      itemId="a"
      buckets={buckets}
      workflows={[]}
      onItem={onItem}
      onNext={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return screen.findByRole('article', { name: 'Sighting 1 of 2: Plane' });
};
const sighting = (n: number) => screen.getByRole('article', { name: `Sighting ${n} of 2: Plane` });
const reviews = () => puts.map(p => [p.id, p.body.review]).sort();

// jsdom's :focus-visible does not follow how the focus came; a browser's matches only keyboard focus.
const focusVisible = (visible: boolean) => {
  const matches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) {
    return selector === ':focus-visible' ? visible && this === document.activeElement : matches.call(this, selector);
  });
};
it('leaves Enter and Space on a button reached from the keyboard to that button', async () => {
  const first = await openReviewer();
  const none = within(first).getByRole('button', { name: /None/ });
  none.focus();
  focusVisible(true); // as a browser reports a button reached with Tab
  for (const key of ['Enter', ' '])
    await act(async () => {
      fireEvent.keyDown(none, { key });
    });
  expect(reviews()).toEqual([]);
});

it('keeps Enter as Confirm when a click left focus on a button', async () => {
  const first = await openReviewer();
  const confirm = within(first).getByRole('button', { name: 'Confirm' });
  focusVisible(false); // a browser keeps focus on a clicked button, but not :focus-visible
  confirm.focus();
  await act(async () => {
    fireEvent.click(confirm);
  });
  await act(async () => {
    fireEvent.keyDown(confirm, { key: 'Enter' });
  });
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
    ['c', 'accepted'],
  ]);
});

it('plays the sighting first, and Confirm decides all its photos, moves on, and can be undone', async () => {
  const onItem = vi.fn();
  const first = await openReviewer(onItem);
  expect(within(first).getByLabelText('Sighting video').getAttribute('src')).toBe(
    '/api/video/sky01/20260925T080302Z#t=37',
  );
  expect(within(first).getByText('Night planes')).toBeTruthy();
  await act(async () => {
    fireEvent.click(within(first).getByRole('button', { name: 'Confirm' }));
  });
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
  ]);
  expect(sighting(2).getAttribute('data-current')).toBe('true');
  expect(within(sighting(1)).getByRole('button', { name: 'Confirm' }).getAttribute('aria-pressed')).toBe('true');
  expect(onItem).toHaveBeenLastCalledWith('c');
  expect(screen.getByRole('progressbar', { name: 'Sightings reviewed' }).getAttribute('aria-valuenow')).toBe('1');
  puts = [];
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  });
  expect(reviews()).toEqual([
    ['a', 'pending'],
    ['b', 'pending'],
  ]);
  expect(sighting(1).getAttribute('data-current')).toBe('true');
});

it('ends on the workflow’s next run with photos to review, else on another workflow with some', async () => {
  const onNext = vi.fn(),
    draft = (id: string, name: string) => ({ id, name, updatedAt: '', nodes: [], edges: [] });
  const workflows = [draft('flow', 'Night planes'), draft('quiet', 'Wildlife'), draft('meteors', 'Night meteors')];
  const { unmount } = render(
    <RunReview
      runId="run"
      itemId="a"
      buckets={buckets}
      workflows={workflows}
      onItem={vi.fn()}
      onNext={onNext}
      onBack={vi.fn()}
    />,
  );
  fireEvent.click(
    await within(await screen.findByRole('article', { name: 'End of sightings' })).findByRole('button', {
      name: 'Next run · 4 to review',
    }),
  );
  expect(onNext).toHaveBeenLastCalledWith({ kind: 'run', id: 'older', name: 'Next run', pending: 4 });
  unmount();
  // This run’s own photos never count as next; neither does this workflow’s total.
  workflowRuns = [{ id: 'run', pending: 3 }];
  pendingByWorkflow = [
    { workflow_id: 'flow', pending: 3 },
    { workflow_id: 'quiet', pending: 0 },
    { workflow_id: 'meteors', pending: 7 },
  ];
  render(
    <RunReview
      runId="run"
      itemId="a"
      buckets={buckets}
      workflows={workflows}
      onItem={vi.fn()}
      onNext={onNext}
      onBack={vi.fn()}
    />,
  );
  fireEvent.click(
    await within(await screen.findByRole('article', { name: 'End of sightings' })).findByRole('button', {
      name: 'Night meteors · 7 to review',
    }),
  );
  expect(onNext).toHaveBeenLastCalledWith({ kind: 'workflow', id: 'meteors', name: 'Night meteors', pending: 7 });
});
it('keeps only the tightest of boxes drawn around one object, and leaves separate objects alone', () => {
  const label = (box: number[], confidence = 0.5, class_name = 'Plane') => ({
    box,
    class_id: 0,
    class_name,
    confidence,
    model_node: 'model',
  });
  // Real pairs from the Meteors bucket: a Plane box around a Meteorite's, and one Meteorite box inside another.
  expect(
    overlapped([
      label([0.0666, 0.6118, 0.0887, 0.6299], 0.247, 'Meteorite'),
      label([0.0668, 0.6118, 0.0888, 0.6306], 0.143),
    ]),
  ).toEqual([1]);
  expect(
    overlapped([label([0.6641, 0.1243, 0.7, 0.1825], 0.419), label([0.6719, 0.1302, 0.6938, 0.1773], 0.112)]),
  ).toEqual([0]);
  expect(overlapped([label([0.2, 0.2, 0.3, 0.3], 0.2), label([0.2, 0.2, 0.3, 0.3], 0.6)])).toEqual([0]);
  expect(
    overlapped([
      label([0.2, 0.78, 0.21, 0.81]),
      label([0.93, 0.29, 0.95, 0.31]),
      label([0.2, 0.2, 0.3, 0.3]),
      label([0.28, 0.28, 0.4, 0.4]),
    ]),
  ).toEqual([]);
});
it('Confirm saves each photo without boxes around a tighter one, and Undo puts them back', async () => {
  const first = review.items[0],
    before = first.annotation_json,
    labels = JSON.parse(before);
  first.annotation_json = JSON.stringify([...labels, { ...labels[0], box: [0.38, 0.18, 0.47, 0.27], confidence: 0.3 }]);
  try {
    const card = await openReviewer();
    expect(within(card).getByText('Confirm removes 1 overlapping box')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    });
    expect(puts.map(p => [p.id, p.body.review, p.body.annotations?.length])).toEqual([
      ['a', 'accepted', 1],
      ['b', 'accepted', undefined],
    ]);
    expect(puts[0].body.annotations).toEqual([labels[0]]);
    puts = [];
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
    expect(puts.map(p => [p.id, p.body.review, p.body.annotations?.length])).toEqual([
      ['a', 'pending', 2],
      ['b', 'pending', undefined],
    ]);
  } finally {
    first.annotation_json = before;
  }
});
it('moves through photos and sightings by keyboard, and pressing a lit choice again clears it', async () => {
  const onItem = vi.fn();
  const first = await openReviewer(onItem);
  await key('ArrowRight');
  expect(within(first).getByText('Photo 1 of 2')).toBeTruthy();
  await key('ArrowRight');
  expect(within(first).getByText('Photo 2 of 2')).toBeTruthy();
  expect(onItem).toHaveBeenLastCalledWith('b');
  await key('n');
  expect(reviews()).toEqual([
    ['a', 'rejected'],
    ['b', 'rejected'],
  ]);
  expect(sighting(2).getAttribute('data-current')).toBe('true');
  await key('ArrowUp');
  expect(sighting(1).getAttribute('data-current')).toBe('true');
  puts = [];
  await key('n');
  expect(reviews()).toEqual([
    ['a', 'pending'],
    ['b', 'pending'],
  ]);
  expect(sighting(1).getAttribute('data-current')).toBe('true');
});

it('double-tapping the picture says Yes to the whole sighting, and never takes a Yes back', async () => {
  const first = await openReviewer();
  const stage = first.querySelector('.wk-card-stage')!;
  await act(async () => {
    fireEvent.click(stage);
  });
  expect(puts).toHaveLength(0);
  await act(async () => {
    fireEvent.click(stage);
  });
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
  ]);
  expect(first.querySelector('.wk-burst')).toBeTruthy();
  // The card holds while its check shows, then moves on.
  expect(sighting(1).getAttribute('data-current')).toBe('true');
  await waitFor(() => expect(sighting(2).getAttribute('data-current')).toBe('true'));
  puts = [];
  await key('ArrowUp');
  await act(async () => {
    fireEvent.click(stage);
    fireEvent.click(stage);
  });
  expect(puts).toHaveLength(0);
});

it('puts back photos whose decision failed to save and says so', async () => {
  const first = await openReviewer();
  failSave = true;
  await act(async () => {
    fireEvent.click(within(first).getByRole('button', { name: 'None' }));
  });
  expect(screen.getByRole('status').textContent).toContain('Couldn’t save 2 of 2 photos. Save interrupted. Try again.');
  expect(within(first).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('false');
});

it('edits a label class in the editor and saves it without changing the review', async () => {
  await openReviewer();
  await key('e');
  const editor = within(screen.getByRole('dialog', { name: 'Edit labels' }));
  await key('2');
  expect(editor.getByRole('button', { name: /Meteorite\s*Edited/ })).toBeTruthy();
  await act(async () => {
    fireEvent.click(editor.getByRole('button', { name: 'Done' }));
  });
  expect(puts).toEqual([
    {
      id: 'a',
      body: {
        review: 'pending',
        annotations: [expect.objectContaining({ class_name: 'Meteorite', box: [0.4, 0.2, 0.45, 0.25] })],
      },
    },
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Back (or the iOS edge swipe) as the browser does it: the entry changes first, then popstate arrives.
const back = () =>
  act(
    () =>
      new Promise<void>(done => {
        window.addEventListener('popstate', () => setTimeout(done), { once: true });
        history.back();
      }),
  );
it('Back closes the label editor instead of leaving the review, asking first about unsaved edits', async () => {
  await openReviewer();
  await key('e');
  await back();
  expect(screen.queryByRole('dialog', { name: 'Edit labels' })).toBeNull();
  expect(sighting(1)).toBeTruthy();
  await key('e');
  const editor = within(screen.getByRole('dialog', { name: 'Edit labels' }));
  await key('2');
  await back();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(editor.getByRole('button', { name: /Meteorite\s*Edited/ })).toBeTruthy();
  await back();
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(puts).toHaveLength(0);
  // Closing gives back the editor's entry, so the next Back leaves the review in one press.
  await waitFor(() => expect(history.state?.overlay).toBeUndefined());
});
it('draws, deletes, and restores boxes, then a Yes saves them with that one photo and opens the next', async () => {
  await openReviewer();
  await key('e');
  const dialog = screen.getByRole('dialog', { name: 'Edit labels' }),
    editor = within(dialog);
  const canvas = dialog.querySelector('.wk-editor-canvas')!;
  await key('b');
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  // Released past the last move: the box ends where the pointer lifts, not at the last drawn draft.
  fireEvent.pointerMove(canvas, { clientX: 130, clientY: 120, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 160, clientY: 140, pointerId: 1 });
  expect(editor.getByRole('menu', { name: 'Choose a class' })).toBeTruthy();
  await key('2');
  expect(editor.queryByRole('menu')).toBeNull();
  await key('Backspace');
  expect(editor.queryByRole('button', { name: /Meteorite/ })).toBeNull();
  await key('z', { metaKey: true });
  expect(editor.getByRole('button', { name: /Meteorite/ })).toBeTruthy();
  await act(async () => {
    fireEvent.click(editor.getByRole('button', { name: 'Yes' }));
  });
  expect(puts).toHaveLength(1);
  const saved = puts[0].body.annotations as unknown as { class_name: string; box: number[] }[];
  expect(puts[0]).toMatchObject({ id: 'a', body: { review: 'accepted' } });
  expect(saved.map(label => label.class_name)).toEqual(['Plane', 'Meteorite']);
  // The camera starts on the top box at 5/9 screen px per frame px: (100, 100)–(160, 140) on screen.
  [0.3219, 0.1583, 0.35, 0.1917].forEach((n, i) => expect(saved[1].box[i]).toBeCloseTo(n, 3));
  expect(editor.getByText('Photo 2 of 2')).toBeTruthy();
});

it('resizes a box by its corner handle, undoes the drag as one step, and saves the new edges', async () => {
  await openReviewer();
  await key('e');
  const dialog = screen.getByRole('dialog', { name: 'Edit labels' }),
    editor = within(dialog);
  // The top box sits at (266.7, 150) and is 106.7 × 60 on screen; drag its bottom-right corner 20 px out.
  const drag = () => {
    const corner = dialog.querySelector('[data-handle=se]')!,
      canvas = dialog.querySelector('.wk-editor-canvas')!;
    fireEvent.pointerDown(corner, { clientX: 373, clientY: 210, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 383, clientY: 220, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 393, clientY: 230, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 393, clientY: 230, pointerId: 1 });
  };
  drag();
  expect(editor.getByRole('button', { name: /Plane\s*Edited/ })).toBeTruthy();
  await key('z', { metaKey: true });
  expect(editor.getByRole('button', { name: /Plane\s*60%/ })).toBeTruthy();
  await key('z', { metaKey: true, shiftKey: true });
  expect(editor.getByRole('button', { name: /Plane\s*Edited/ })).toBeTruthy();
  await act(async () => {
    fireEvent.click(editor.getByRole('button', { name: 'Done' }));
  });
  const box = (puts[0].body.annotations as unknown as { box: number[] }[])[0].box;
  [0.4, 0.2, 0.4594, 0.2667].forEach((n, i) => expect(box[i]).toBeCloseTo(n, 3));
});

it('frames a box with room around it, never past the frame or beyond the zoom limit', () => {
  const view = { width: 640, height: 360 },
    frame = { width: 3840, height: 2160 };
  const middle = focusCamera(view, frame, [0.4, 0.2, 0.45, 0.25], 6, 16);
  expect(middle.scale).toBeCloseTo(640 / 1152);
  expect(middle.x + 0.425 * 3840 * middle.scale).toBeCloseTo(320);
  const corner = focusCamera(view, frame, [0, 0, 0.01, 0.01], 4, 16);
  expect([corner.x, corner.y]).toEqual([0, 0]);
  expect(focusCamera(view, frame, [0.5, 0.5, 0.5001, 0.5001], 4, 3).scale).toBe(3);
  expect(focusCamera(view, frame).scale).toBeCloseTo(1 / 6);
  expect(clampCamera({ width: 1000, height: 360 }, frame, { scale: 1 / 6, x: 99, y: 5 })).toEqual({
    scale: 1 / 6,
    x: 180,
    y: 0,
  });
  const zoomed = zoomCamera(view, frame, middle, 2, { x: 100, y: 50 }, 16);
  expect((100 - zoomed.x) / zoomed.scale).toBeCloseTo((100 - middle.x) / middle.scale);
});

it('resizes and moves boxes inside the frame without flipping them', () => {
  expect(dragBox([0.2, 0.2, 0.4, 0.4], 'move', 0.7, -0.5, [0.01, 0.01])).toEqual([0.8, 0, 1, 0.2]);
  expect(dragBox([0.2, 0.2, 0.4, 0.4], 'se', 0.1, 0.1, [0.01, 0.01]).map(n => +n.toFixed(6))).toEqual([
    0.2, 0.2, 0.5, 0.5,
  ]);
  expect(dragBox([0.2, 0.2, 0.4, 0.4], 'w', 0.5, 0, [0.01, 0.01])).toEqual([0.39, 0.2, 0.4, 0.4]);
  expect(dragBox([0.2, 0.2, 0.4, 0.4], 'n', 0, -0.5, [0.01, 0.01])).toEqual([0.2, 0, 0.4, 0.4]);
});

it('follows the object between photos and loops a second either side of the sighting', () => {
  const [first] = groupSightings(review.items);
  const at = (second: number) => Date.UTC(2026, 8, 25, 8, 3, second);
  const moved = {
    ...first,
    frames: [
      first.frames[0],
      {
        ...first.frames[1],
        annotation_json: JSON.stringify([
          { box: [0.6, 0.4, 0.65, 0.45], class_id: 0, class_name: 'Plane', confidence: 0.6, model_node: 'model' },
        ]),
      },
    ],
  };
  expect(boxAt(moved.frames, at(41))!.map(n => +n.toFixed(6))).toEqual([0.5, 0.3, 0.55, 0.35]);
  expect(boxAt(moved.frames, at(40))).toEqual([0.4, 0.2, 0.45, 0.25]);
  expect(boxAt(moved.frames, at(39))).toBeNull();
  expect(boxAt(moved.frames, at(43))).toBeNull();
  expect(sightingClip(first, review.recordings)).toEqual({ recording: review.recordings[0], from: 37, to: 41 });
  expect(sightingClip(first, [{ ...review.recordings[0], cam: 'sky02' }])).toBeNull();
});

// --- Deciding fast: what a sighting is, Enter, and batches of whole videos ---
const labelled = (id: string, labels: { box: number[]; class_name: string; confidence: number }[]) => ({
  ...frame(id, 0),
  annotation_json: JSON.stringify(
    labels.map(l => ({ ...l, class_id: l.class_name === 'Plane' ? 0 : 1, model_node: 'model' })),
  ),
});
const kept = (labels?: { class_name: string; box?: number[]; confidence: number }[]) =>
  labels?.map(l => [l.class_name, l.confidence]);
it('keeps the box of the class a sighting is confirmed as, and renames only its object', () => {
  // Real photos from the Meteors bucket: one satellite boxed as both a Plane and a Meteorite.
  const both = labelled('7991d31a', [
    { box: [0.8062, 0.0951, 0.8188, 0.1132], class_name: 'Plane', confidence: 0.488 },
    { box: [0.807, 0.0957, 0.8195, 0.1116], class_name: 'Meteorite', confidence: 0.322 },
  ]);
  expect(overlapped(JSON.parse(both.annotation_json))).toEqual([0]);
  expect(kept(decidedLabels(both, 'Plane'))).toEqual([['Plane', 0.488]]);
  expect(kept(decidedLabels(both, 'Meteorite'))).toEqual([['Meteorite', 0.322]]);
  const flipped = labelled('e96b6457', [
    { box: [0.7945, 0.1128, 0.8102, 0.1326], class_name: 'Meteorite', confidence: 0.315 },
    { box: [0.7945, 0.1139, 0.8086, 0.1325], class_name: 'Plane', confidence: 0.309 },
  ]);
  expect(kept(decidedLabels(flipped, 'Meteorite'))).toEqual([['Meteorite', 0.315]]);
  expect(kept(decidedLabels(flipped, 'Plane'))).toEqual([['Plane', 0.309]]);
  // One box renamed; a second object in the photo stays as it was.
  const two = labelled('two', [
    { box: [0.46, 0.87, 0.49, 0.9], class_name: 'Meteorite', confidence: 0.7 },
    { box: [0.002, 0.449, 0.014, 0.466], class_name: 'Plane', confidence: 0.6 },
  ]);
  expect(decidedLabels(two, 'Plane')?.map(l => [l.class_name, l.class_id, l.box])).toEqual([
    ['Plane', 0, [0.46, 0.87, 0.49, 0.9]],
    ['Plane', 0, [0.002, 0.449, 0.014, 0.466]],
  ]);
  expect(decidedLabels(two, 'Meteorite')).toBeUndefined();
});
it('batches sightings as whole videos, about a screen of photos each', () => {
  const at = (minute: number, second: number, id: string, photos = 1) => ({
    id,
    bucketId: 'b',
    className: 'Plane',
    frames: Array.from({ length: photos }, (_, i) => ({
      ...frame(`${id}${i}`, second),
      captured_at: new Date(Date.UTC(2026, 8, 25, 8, minute, second)).toISOString(),
    })),
  });
  const batches = batchSightings([
    at(1, 5, 'a', 20),
    at(1, 30, 'b', 20),
    at(2, 0, 'c', 10),
    at(3, 0, 'd', 60),
    at(4, 0, 'e', 2),
  ]);
  expect(batches.map(b => [b.videos.map(v => v.sightings), b.photos])).toEqual([
    [[[0, 1]], 40],
    [[[2]], 10],
    [[[3]], 60],
    [[[4]], 2],
  ]);
  expect(batchSightings([at(1, 5, 'a', 5), at(2, 0, 'b', 5)]).map(b => b.videos.map(v => v.sightings))).toEqual([
    [[0], [1]],
  ]);
});
it('a number key says what the sighting is, Enter confirms all its photos as that and moves on, and Undo puts them back', async () => {
  const first = await openReviewer();
  await key('2');
  expect(within(first).getByRole('heading', { name: 'Meteorite' })).toBeTruthy();
  expect(within(first).getByText('Changed · press ⏎ to save')).toBeTruthy();
  expect(puts).toHaveLength(0);
  await key('Enter');
  expect(puts.map(p => [p.id, p.body.review, p.body.annotations?.map(l => l.class_name)])).toEqual([
    ['a', 'accepted', ['Meteorite']],
    ['b', 'accepted', ['Meteorite']],
  ]);
  expect(sighting(2).getAttribute('data-current')).toBe('true');
  expect(screen.getByRole('status').textContent).toContain('Meteorite · Confirmed');
  puts = [];
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  });
  expect(puts.map(p => [p.id, p.body.review, p.body.annotations?.map(l => l.class_name)])).toEqual([
    ['a', 'pending', ['Plane']],
    ['b', 'pending', ['Plane']],
  ]);
});
it('Enter on a right label confirms it as is, and a held key never confirms a run of sightings', async () => {
  await openReviewer();
  await key('Enter', { repeat: true });
  expect(puts).toHaveLength(0);
  await key('2');
  await key('1');
  await key('Enter');
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
  ]);
  expect(puts.every(p => !p.body.annotations)).toBe(true);
  expect(sighting(2).getAttribute('data-current')).toBe('true');
});
it('opens sightings on their surest photo when set to, and remembers the choice', async () => {
  const items = review.items,
    before = items[1].annotation_json;
  items[1].annotation_json = before.replace('"confidence":0.6', '"confidence":0.9');
  onTestFinished(() => {
    items[1].annotation_json = before;
  });
  const stored = new Map([['workshop.reviewer', JSON.stringify({ open: 'photo', view: 'feed' })]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => {
      stored.set(k, v);
    }),
  });
  const first = await openReviewer();
  expect(within(first).getByText('Photo 2 of 2')).toBeTruthy();
  fireEvent.click(within(first).getByRole('button', { name: 'Opens sightings on the photo' }));
  expect(JSON.parse(stored.get('workshop.reviewer')!)).toEqual({ open: 'video', view: 'feed' });
  await key('ArrowDown');
  expect(within(sighting(2)).getByText('Video')).toBeTruthy();
});
it('the batch grid shows every photo; marked ones save as marked and the rest as their sighting, with one Undo', async () => {
  await openReviewer();
  await key('g');
  const grid = within(screen.getByRole('region', { name: 'Batch review' }));
  expect(grid.getByText('Batch 1 of 1')).toBeTruthy();
  expect(grid.getAllByRole('button', { name: /, photo \d of \d/ }).map(b => b.getAttribute('data-photo'))).toEqual([
    'a',
    'b',
    'c',
  ]);
  fireEvent.click(grid.getByRole('button', { name: /^Plane, photo 2 of 2/ }));
  await key('2');
  fireEvent.click(grid.getByRole('button', { name: /^Plane, photo 1 of 1/ }));
  await key('n');
  expect(grid.getByRole('button', { name: /^Meteorite, photo 2 of 2/ })).toBeTruthy();
  expect(grid.getByRole('button', { name: /^Confirm batch/ }).textContent).toContain('1 Yes · 1 relabeled · 1 None');
  await key('Enter');
  expect(puts.map(p => [p.id, p.body.review, p.body.annotations?.map(l => l.class_name)]).sort()).toEqual([
    ['a', 'accepted', undefined],
    ['b', 'accepted', ['Meteorite']],
    ['c', 'rejected', undefined],
  ]);
  expect(grid.getByText('All batches')).toBeTruthy();
  puts = [];
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  });
  expect(puts.map(p => [p.id, p.body.review]).sort()).toEqual([
    ['a', 'pending'],
    ['b', 'pending'],
    ['c', 'pending'],
  ]);
  expect(grid.getByText('Batch 1 of 1')).toBeTruthy();
});
it('the batch grid leaves photos decided earlier as they were, unless marked', async () => {
  await openReviewer();
  await key('n');
  puts = [];
  await key('g');
  await key('Enter');
  expect(reviews()).toEqual([['c', 'accepted']]);
});
it('the batch grid saves nothing until every photo has been on screen, and Space opens one in the feed', async () => {
  const observers: { callback: IntersectionObserverCallback; cells: Element[] }[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      cells: Element[] = [];
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, cells: this.cells });
      }
      observe(cell: Element) {
        this.cells.push(cell);
      }
      disconnect() {}
    },
  );
  await openReviewer();
  await key('g');
  const grid = within(screen.getByRole('region', { name: 'Batch review' }));
  await key('Enter');
  expect(puts).toHaveLength(0);
  expect(grid.getByRole('status').textContent).toContain('Scroll through the whole batch');
  const { callback, cells } = observers.at(-1)!;
  act(() =>
    callback(
      cells.map(target => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry),
      {} as IntersectionObserver,
    ),
  );
  await key('Enter');
  expect(reviews()).toEqual([
    ['a', 'accepted'],
    ['b', 'accepted'],
    ['c', 'accepted'],
  ]);
  await act(async () => {
    fireEvent.click(grid.getByRole('button', { name: 'Previous batch' }));
  });
  await key('ArrowRight');
  await key(' ');
  expect(screen.queryByRole('region', { name: 'Batch review' })).toBeNull();
  expect(within(sighting(1)).getByText('Photo 2 of 2')).toBeTruthy();
});

// --- Loading ahead, so a sighting opens at once ---
it('lays the object thumbnail the grid already loaded over its spot in the photo, under the original', async () => {
  const first = await openReviewer();
  await key('ArrowRight');
  const stage = within(first)
    .getAllByRole('img', { name: /^Camera frame at/ })[0]
    .closest<HTMLElement>('.wk-stage')!;
  const [thumbnail, original] = stage.querySelectorAll<HTMLImageElement>('img.wk-stage-layer');
  expect(thumbnail.getAttribute('src')).toMatch(
    /^\/api\/workshop\/items\/a\/thumbnail\?format=1&mode=object&size=512&/,
  );
  expect(original.getAttribute('src')).toBe('/api/workshop/items/a/image');
  // The box [.4, .2, .45, .25] in 3840 × 2160: a 1.6× crop around it, 308 × 173 frame px.
  expect([thumbnail.style.width, thumbnail.style.height]).toEqual(['308px', '173px']);
});
it('loads the photos ahead of the one on screen into the browser cache', async () => {
  const loaded: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      set src(url: string) {
        loaded.push(url);
      }
    },
  );
  await openReviewer();
  expect(loaded).toEqual(['/api/workshop/items/a/image', '/api/workshop/items/b/image', '/api/workshop/items/c/image']);
});
