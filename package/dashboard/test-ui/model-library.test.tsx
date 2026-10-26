import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelLibrary } from '../ui/components/model-library';
import type { ModelVersion, ModelDeviceDescription } from '../src/models/modelInferencemodel';

const first: ModelVersion = {
  family: 'combined',
  version: 'v1',
  name: 'Combined detector · tiled',
  description: 'Tiled detector for small objects.',
  task: 'object-detection',
  adapter: 'ultralytics',
  classes: [
    { id: 0, name: 'Plane' },
    { id: 1, name: 'Bird' },
  ],
  input: { training_size: [640, 640] },
  evaluations: [
    {
      label: 'Validation checkpoint',
      dataset: 'sky/test-v1',
      split: 'validation',
      input_size: 640,
      independently_reproduced: false,
      metrics: { 'metrics/precision(B)': 0.52, tiled: { recall: 0.4 } },
      source: { kind: 'checkpoint' },
    },
  ],
  caveats: ['No common benchmark.'],
  artifacts: [{ filename: 'best.pt', sha256: 'a'.repeat(64), bytes: 1048576, format: 'pytorch-checkpoint' }],
  dependencies: [],
};
const second: ModelVersion = {
  ...first,
  version: 'v2',
  name: 'Combined detector · full frame',
  description: 'Full frame detector.',
  input: { training_size: 1280 },
  artifacts: [{ ...first.artifacts[0], sha256: 'b'.repeat(64) }],
};
const other: ModelVersion = {
  ...first,
  family: 'weather',
  version: 'v1',
  name: 'Weather classifier',
  task: 'image-classification',
  adapter: 'unsupported',
  classes: [{ id: 0, name: 'Clear' }],
  evaluations: [],
};
const device: ModelDeviceDescription = {
  id: 'gpu-box',
  revision: 'current-revision',
  reported_revision: 'current-revision',
  status: 'ready',
  error: null,
  updated_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  deployment: {
    schema_version: 1,
    device_id: 'gpu-box',
    revision: 'current-revision',
    created_at: new Date().toISOString(),
    models: [
      {
        slot: 'detector',
        model: first,
        artifact: first.artifacts[0],
        parameters: { imgsz: 640, confidence: 0.3, iou: 0.5, device: 'auto' },
      },
    ],
  },
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  history.replaceState(null, '', '/?view=models');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  fetchMock = vi.fn(async (path: string) =>
    json(path === '/api/models' ? { models: [first, second, other] } : { devices: [device] }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('groups versions, switches the selected checkpoint, and keeps model browsing out of a dialog', async () => {
  render(<ModelLibrary onKeys={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Combined detector, 2 versions/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const selector = screen.getByRole('combobox', { name: 'Model version' });
  fireEvent.keyDown(selector, { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: 'v2', exact: true }), { key: 'Enter' });
  expect(screen.getByRole('heading', { name: second.name })).toBeTruthy();
  expect(new URLSearchParams(location.search).get('model')).toBe('combined/v2');
  fireEvent.keyDown(screen.getByRole('tab', { name: /^Files/ }), { key: 'Enter' });
  expect(await screen.findByText('b'.repeat(64))).toBeTruthy();
  expect(screen.queryByText('a'.repeat(64))).toBeNull();
});

it('restores deep-linked evaluations and renders their numeric records with provenance', async () => {
  history.replaceState(null, '', '/?view=models&model=combined%2Fv2&modelSection=evaluations');
  render(<ModelLibrary onKeys={vi.fn()} />);
  const table = await screen.findByRole('table', { name: 'Validation checkpoint metrics' });
  expect(within(table).getByRole('row', { name: 'Precision 0.52' })).toBeTruthy();
  expect(within(table).getByRole('row', { name: 'Tiled · Recall 0.4' })).toBeTruthy();
  expect(screen.getByText('Reported by the training run')).toBeTruthy();
  expect(screen.getByRole('heading', { name: second.name })).toBeTruthy();
});

it('keeps evaluation values and context together when switching sources and versions', async () => {
  const recorded = {
    ...first,
    evaluations: [
      ...first.evaluations,
      {
        label: 'Original model card',
        dataset: 'sky/legacy-v1',
        split: 'test',
        input_size: 1280,
        metrics: { recall: 0.37 },
        source: 'original-card.md',
      },
    ],
  };
  fetchMock.mockImplementation(async (path: string) =>
    json(path === '/api/models' ? { models: [recorded, second] } : { devices: [] }),
  );
  history.replaceState(null, '', '/?view=models&model=combined%2Fv1&modelSection=evaluations');
  render(<ModelLibrary onKeys={vi.fn()} />);

  const source = await screen.findByRole('combobox', { name: 'Evaluation source' });
  fireEvent.keyDown(source, { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: 'Original model card' }), { key: 'Enter' });
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(
    within(screen.getByRole('table', { name: 'Original model card metrics' })).getByRole('row', {
      name: 'Recall 0.37',
    }),
  ).toBeTruthy();
  expect(screen.getByText('sky/legacy-v1')).toBeTruthy();
  expect(screen.queryByText('sky/test-v1')).toBeNull();
  expect(screen.queryByText('0.52')).toBeNull();

  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model version' }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: 'v2', exact: true }), { key: 'Enter' });
  expect(screen.getByRole('table', { name: 'Validation checkpoint metrics' })).toBeTruthy();
  expect(screen.getByText('sky/test-v1')).toBeTruthy();
  expect(screen.queryByText('0.37')).toBeNull();
});

it('preserves a search on the return to the library and recovers from empty results', async () => {
  render(<ModelLibrary onKeys={vi.fn()} />);
  await screen.findByRole('button', { name: /Combined detector, 2 versions/ });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a model' }), { target: { value: 'Clear' } });
  fireEvent.click(screen.getByRole('button', { name: 'Weather classifier, 1 version' }));
  fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Clear');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not-a-model' } });
  expect(screen.getByRole('heading', { name: 'No matching models' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('button', { name: /Combined detector, 2 versions/ })).toBeTruthy();
});

it('keeps the pinned revision and settings when applying device edits', async () => {
  render(<ModelLibrary onKeys={vi.fn()} />);
  await screen.findByRole('button', { name: /Combined detector, 2 versions/ });
  fireEvent.keyDown(screen.getByRole('tab', { name: /^Devices/ }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Confidence' }), { target: { value: '0.42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply configuration' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const [, options] = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(options.body)).toEqual({
    previous_revision: 'current-revision',
    models: [
      {
        slot: 'detector',
        family: 'combined',
        version: 'v1',
        sha256: 'a'.repeat(64),
        parameters: { imgsz: 640, confidence: 0.42, iou: 0.5, device: 'auto' },
      },
    ],
  });
});

it('keeps a rejected device edit open with the submitted values intact', async () => {
  render(<ModelLibrary onKeys={vi.fn()} />);
  await screen.findByRole('button', { name: /Combined detector, 2 versions/ });
  fireEvent.keyDown(screen.getByRole('tab', { name: /^Devices/ }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  fetchMock.mockResolvedValueOnce(json({ error: 'Assignment changed. Refresh before trying again.' }, 409));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Confidence' }), { target: { value: '0.42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply configuration' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByRole('spinbutton', { name: 'Confidence' }) as HTMLInputElement).value).toBe('0.42');
  expect((screen.getByRole('button', { name: 'Apply configuration' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/Configuration sent/)).toBeNull();
});

it('opens the catalog without silently selecting a model, and restores search and sort from the URL', async () => {
  history.replaceState(null, '', '/?view=models&modelQuery=Plane&modelSort=desc');
  render(<ModelLibrary onKeys={vi.fn()} />);
  const table = await screen.findByRole('table', { name: 'Your trained models, grouped by family' });
  expect(screen.queryByRole('article')).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Plane');
  expect(within(table).getByRole('columnheader', { name: 'Model' }).getAttribute('aria-sort')).toBe('descending');
  expect(screen.queryByRole('button', { name: 'Weather classifier, 1 version' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Combined detector, 2 versions/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Plane');
  expect(new URLSearchParams(location.search).get('modelSort')).toBe('desc');
});

it('reports a missing model rather than displaying an unrelated version', async () => {
  history.replaceState(null, '', '/?view=models&model=missing%2Fv1');
  render(<ModelLibrary onKeys={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Model version not found' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: first.name })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to library' }));
  expect(screen.getByRole('table', { name: 'Your trained models, grouped by family' })).toBeTruthy();
});

it('opens a version that matches the active compatibility filter within a mixed family', async () => {
  fetchMock.mockImplementation(async (path: string) =>
    json(path === '/api/models' ? { models: [{ ...first, adapter: 'unsupported' }, second] } : { devices: [] }),
  );
  history.replaceState(null, '', '/?view=models&modelFilter=deployable');
  render(<ModelLibrary onKeys={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Combined detector, 2 versions' }));
  expect(screen.getByRole('heading', { name: second.name })).toBeTruthy();
  expect(new URLSearchParams(location.search).get('model')).toBe('combined/v2');
});

it('previews archive selections, preserves a test link, and never treats model synchronization as test execution', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const clip = {
    start: `${today}T01:00:00.000Z`,
    duration_s: 59,
    size: 100,
    frames: 1800,
    width: 3840,
    height: 2160,
    bitrate: 4000,
    codec: 'hevc',
  };
  const another = { ...clip, start: `${today}T01:01:00.000Z` };
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/models') return json({ models: [first, second, other] });
    if (path === '/api/models/devices') return json({ devices: [device] });
    if (path.startsWith('/api/availability')) return json({ days: [`${today}T00:00:00.000Z`] });
    if (path.startsWith('/api/segments')) return json({ segments: [clip, another] });
    if (path === '/api/overview')
      return json({ cameras: ['sky01'], cam: 'sky01', generated_at: new Date().toISOString() });
    throw new Error(`Unexpected request: ${path}`);
  });
  history.replaceState(
    null,
    '',
    `/?view=models&model=combined%2Fv1&tz=UTC&modelMode=test&testCam=sky01&testDay=${today}&testAt=${encodeURIComponent(clip.start)}`,
  );
  render(<ModelLibrary onKeys={vi.fn()} />);
  const video = await screen.findByLabelText('Selected recording preview');
  expect(video.getAttribute('src')).toContain('T010000Z');
  expect(screen.getByText('Model files synchronized')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Run test' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /01:01:00/ }));
  expect(screen.getByLabelText('Selected recording preview').getAttribute('src')).toContain('T010100Z');
  expect(new URLSearchParams(location.search).get('testAt')).toBe(another.start);
  expect(screen.getByRole('link', { name: 'Open in Recordings' }).getAttribute('href')).toContain(
    encodeURIComponent(another.start),
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find recording time' }), { target: { value: '03:00' } });
  expect(screen.getByText('No recordings match that time.')).toBeTruthy();
  expect(screen.getByLabelText('Selected recording preview')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to model' }));
  expect(screen.getByRole('heading', { name: first.name })).toBeTruthy();
  expect(new URLSearchParams(location.search).has('modelMode')).toBe(false);
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
