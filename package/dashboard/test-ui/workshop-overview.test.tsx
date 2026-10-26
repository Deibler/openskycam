import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkshopOverview } from '../ui/features/workshop/components/workshop-overview';
import { WorkflowDetail } from '../ui/features/workshop/components/workflow-detail';
import { BucketList } from '../ui/features/workshop/components/bucket-list';
import { DailyChart } from '../ui/features/workshop/components/workflow-stats';
import { useWorkshopRoute } from '../ui/features/workshop/hooks/use-workshop-route';
import { WorkshopShell } from '../ui/features/workshop/components/workshop-shell';
import { cameraArchive } from '../ui/features/workshop/service/bucketInferenceService';
import type { WorkshopRunStatus, WorkshopSummary } from '../src/models/workshopInferencemodel';
import type {
  WorkflowDraft,
  WorkflowStep,
  WorkshopCatalog,
} from '../ui/features/workshop/models/workflowInferencemodel';
import type { WorkshopBucket } from '../ui/features/workshop/models/bucketInferencemodel';

const node = (id: string, data: WorkflowStep) => ({ id, type: 'workshop' as const, position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string, sourceHandle = 'out') => ({
  id: `${source}-${target}`,
  source,
  target,
  sourceHandle,
  targetHandle: 'in',
});
const night: WorkflowDraft = {
  id: 'night',
  name: 'Night planes + meteors',
  updatedAt: '',
  edges: [edge('in', 'm'), edge('m', 'c'), edge('c', 'o1', 'yes'), edge('c', 'o2', 'no')],
  nodes: [
    node('in', { kind: 'input', label: 'Input', bucketId: 'camera-archive', camera: 'sky01' }),
    node('m', { kind: 'model', label: 'YOLO26s v6', modelKey: 'yolo/v6', score: 0.3 }),
    node('c', { kind: 'condition', label: 'Meteorite 0.45+', match: 'all', rules: [] }),
    node('o1', { kind: 'output', label: 'Output', bucketId: 'meteors' }),
    node('o2', { kind: 'output', label: 'Output', bucketId: 'planes' }),
  ],
};
const wildlife: WorkflowDraft = {
  id: 'wildlife',
  name: 'Wildlife Detection',
  updatedAt: '',
  edges: [],
  nodes: [
    node('in', { kind: 'input', label: 'Input', bucketId: 'camera-archive', camera: 'sky01' }),
    node('o', { kind: 'output', label: 'Output', bucketId: 'animals' }),
  ],
};
const buckets: WorkshopBucket[] = [
  cameraArchive,
  ...[
    ['meteors', 'Night meteor candidates'],
    ['planes', 'Night planes'],
    ['animals', 'Animals'],
  ].map(([id, name]) => ({ id, name, kind: 'labeled' as const, description: '', createdAt: null })),
];
const catalog: WorkshopCatalog = { models: [], overview: null, loading: false, error: '' };
const run = (id: string, counts: Partial<WorkshopRunStatus>): WorkshopRunStatus => ({
  id,
  request_hash: '',
  workflow_id: 'night',
  name: 'Night',
  runtime_id: 'r',
  snapshot_json: '{"mode":"run"}',
  created_at: new Date(Date.now() - 600000).toISOString(),
  total: 15,
  completed: 15,
  failed: 0,
  expired: 0,
  queued: 0,
  leased: 0,
  cancelled: 0,
  images: 0,
  pending: 0,
  accepted: 0,
  rejected: 0,
  ...counts,
});
const added = new Date(Date.now() - 20 * 60000).toISOString();
const summary: WorkshopSummary = {
  buckets: [
    { bucket_id: 'meteors', images: 40, accepted: 8, rejected: 30, pending: 2, saved: 8, last_added_at: added },
    { bucket_id: 'planes', images: 101, accepted: 0, rejected: 0, pending: 101, saved: 0, last_added_at: added },
  ],
  workflows: [
    {
      workflow_id: 'night',
      runs: 47,
      last_run: run('last', { images: 5 }),
      images: 141,
      accepted: 8,
      rejected: 30,
      pending: 103,
      daily: [{ day: new Date().toISOString().slice(0, 10), images: 141 }],
      classes: [
        { class_name: 'Meteorite', detections: 40, images: 40, accepted: 8, rejected: 30 },
        { class_name: 'Plane', detections: 120, images: 101, accepted: 0, rejected: 0 },
      ],
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows each workflow with the buckets it fills, their counts, and a way into what waits for review; filters and search narrow the cards', () => {
  const open = vi.fn(),
    bucket = vi.fn(),
    review = vi.fn();
  render(
    <WorkshopOverview
      workflows={[night, wildlife]}
      buckets={buckets}
      catalog={catalog}
      summary={summary}
      onOpen={open}
      onReview={review}
      onBucket={bucket}
      onCreate={vi.fn()}
    />,
  );
  const card = within(screen.getByRole('button', { name: 'Night planes + meteors' }).closest('article')!);
  const written = card.getByRole('list', { name: /writes to/ });
  expect(
    within(written)
      .getAllByRole('button')
      .map(b => b.textContent),
  ).toEqual(['Night meteor candidatesMeteorite 0.45+40 images', 'Night planesNot Meteorite 0.45+101 images']);
  expect(card.getByText('103')).toBeTruthy();
  expect(card.getByText(/Last run .* · Complete · 5 sightings/)).toBeTruthy();
  fireEvent.click(card.getByRole('button', { name: 'Review 103' }));
  expect(review).toHaveBeenCalledWith('night');
  expect(
    within(screen.getByRole('button', { name: 'Wildlife Detection' }).closest('article')!).queryByRole('button', {
      name: /^Review/,
    }),
  ).toBeNull();
  fireEvent.click(within(written).getByRole('button', { name: /Night planes/ }));
  expect(bucket).toHaveBeenCalledWith('planes');
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Night planes + meteors' }));
  expect(open).toHaveBeenCalledWith('night');
  fireEvent.click(screen.getByRole('button', { name: /Needs review/ }));
  expect(screen.queryByRole('button', { name: 'Wildlife Detection' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Night planes + meteors' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^All/ }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search workflows and buckets' }), {
    target: { value: 'meteor candidates' },
  });
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

it('lists a workflow’s runs with a way into each review, and its statistics', async () => {
  const review = vi.fn(),
    openRun = vi.fn(),
    reviewAll = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ runs: [run('found', { images: 8, pending: 5 }), run('quiet', {})] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <WorkflowDetail
      workflow={night}
      workflows={[night]}
      buckets={buckets}
      catalog={catalog}
      summary={summary}
      theme="light"
      onBack={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onRun={openRun}
      onReview={review}
      onReviewAll={reviewAll}
      onBucket={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review 103' }));
  expect(reviewAll).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith('/api/workshop/runs?workflow=night', expect.anything());
  fireEvent.click(await screen.findByRole('button', { name: /Review 5/ }));
  expect(review).toHaveBeenCalledWith('found');
  const runs = () => within(screen.getByRole('region', { name: 'Runs' })).getAllByRole('row');
  expect(runs()).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Needs review' }));
  expect(runs()).toHaveLength(2);
  fireEvent.click(within(screen.getByRole('region', { name: 'Runs' })).getAllByRole('button', { name: /ago/ })[0]);
  expect(openRun).toHaveBeenCalledWith('found');
  // Of 38 reviewed sightings, 8 were real.
  expect(within(screen.getByText('Confirmed', { selector: 'dt' }).parentElement!).getByText('21%')).toBeTruthy();
  expect(within(screen.getByRole('row', { name: /Meteorite/ })).getByText('21%')).toBeTruthy();
  expect(within(screen.getByRole('row', { name: /Plane/ })).getByText('Not reviewed')).toBeTruthy();
});

it('names the workflow each bucket comes from, with its images and last addition', () => {
  render(
    <BucketList
      buckets={buckets}
      workflows={[night]}
      summary={summary}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  const row = within(screen.getByRole('button', { name: 'Open Night planes' }));
  expect(row.getByText('From Night planes + meteors')).toBeTruthy();
  expect(row.getByText('101 images')).toBeTruthy();
  expect(row.getByText('101 to review')).toBeTruthy();
  expect(row.getByText('Last added 20 min ago')).toBeTruthy();
  expect(within(screen.getByRole('button', { name: 'Open Animals' })).getByText('No workflow yet')).toBeTruthy();
});

it('keeps old workflow-list links working, carries the sighting a review opens on, and marks the entries it adds', () => {
  history.replaceState({}, '', '/?view=workshop&section=workflows');
  const { result } = renderHook(useWorkshopRoute);
  expect(result.current.route).toEqual({ page: 'overview', id: '', item: '' });
  // A page opened from a link has no Workshop entry to go back to; one this hook added does.
  expect(history.state?.workshop).toBeUndefined();
  act(() => result.current.navigate('review', 'run-1', 'frame-2'));
  expect(history.state).toEqual({ workshop: true });
  expect(new URLSearchParams(location.search).get('run')).toBe('run-1');
  expect(new URLSearchParams(location.search).get('item')).toBe('frame-2');
  const length = history.length;
  act(() => result.current.navigate('review', 'run-1', 'frame-3', true));
  expect(history.length).toBe(length);
  expect(history.state).toEqual({ workshop: true });
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(result.current.route).toEqual({ page: 'review', id: 'run-1', item: 'frame-3' });
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
it('Back closes the phone menu, a page picked there takes the menu’s place in history, and Back returns to where the list was scrolled', async () => {
  history.pushState({}, '', '/?view=workshop&section=overview');
  history.pushState({}, '', '/?view=workshop&section=runs');
  function Page() {
    const { route, navigate } = useWorkshopRoute();
    return (
      <WorkshopShell
        page={route.page}
        title={route.page}
        theme="light"
        onTheme={vi.fn()}
        onNavigate={page => navigate(page)}
        onExit={vi.fn()}
      >
        <p>List</p>
      </WorkshopShell>
    );
  }
  render(<Page />);
  const list = document.getElementById('workshop-content')!;
  Object.defineProperty(list, 'scrollHeight', { value: 5000 }); // jsdom lays nothing out
  list.scrollTop = 1500;
  const menu = () => fireEvent.click(screen.getByRole('button', { name: 'Open Workshop navigation' }));
  menu();
  await back();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(location.search).toBe('?view=workshop&section=runs');
  menu();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Buckets' }));
  expect([location.search, list.scrollTop]).toEqual(['?view=workshop&section=buckets', 0]);
  await back();
  expect(location.search).toBe('?view=workshop&section=runs');
  await waitFor(() => expect(list.scrollTop).toBe(1500));
  await back();
  expect(location.search).toBe('?view=workshop&section=overview');
});
it('draws two weeks of sightings per day, including a workflow that found nothing', () => {
  const { unmount } = render(<DailyChart daily={[]} />);
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('No sightings in the last 14 days');
  unmount();
  const today = new Date().toISOString().slice(0, 10),
    before = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  render(
    <DailyChart
      daily={[
        { day: before, images: 30 },
        { day: today, images: 10 },
        { day: '2020-01-01', images: 99 },
      ]}
    />,
  );
  expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
    /^40 sightings in the last 14 days, most on .* with 30$/,
  );
  expect(screen.getByRole('status').textContent).toMatch(/^30 /);
});
