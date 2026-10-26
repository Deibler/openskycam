import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleFields } from '../ui/features/workshop/components/schedule-fields';
import { FootageFields } from '../ui/features/workshop/components/footage-fields';
import {
  addStep,
  canConnect,
  createWorkflow,
  validateWorkflow,
  workflowEdge,
} from '../ui/features/workshop/service/workflowInferenceService';
import { restoreWorkshop } from '../ui/features/workshop/service/workshopDraftInferenceService';
import { cameraArchive, createBucket } from '../ui/features/workshop/service/bucketInferenceService';
import { nextSlot } from '../ui/features/workshop/utils/scheduleInferenceUtil';
import type { WorkshopBucket } from '../ui/features/workshop/models/bucketInferencemodel';
import type { ModelVersion } from '../src/models/modelInferencemodel';
import type { ScheduleStep, WorkflowDraft } from '../ui/features/workshop/models/workflowInferencemodel';

const model: ModelVersion = {
  family: 'detector',
  version: 'v1',
  name: 'Detector',
  description: '',
  task: 'object-detection',
  adapter: 'ultralytics',
  classes: [{ id: 0, name: 'Bird' }],
  input: {},
  artifacts: [],
  evaluations: [],
  caveats: [],
  dependencies: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const connection = (source: string, target: string) => ({ source, target, sourceHandle: 'out', targetHandle: 'in' });
const schedule: ScheduleStep = {
  kind: 'schedule',
  label: 'Schedule',
  trigger: 'time',
  days: [0, 1, 2, 3, 4, 5, 6],
  at: '13:30',
  workflowId: '',
  onlyIf: false,
};
function scheduled(name: string, change: Partial<ScheduleStep> = {}, day = 'previous-day') {
  const bucket = createBucket(`${name} output`, [cameraArchive]);
  const draft = addStep(createWorkflow(name, cameraArchive, bucket.id), 'schedule', { x: -320, y: 100 });
  const [input, footage, detector, output, clock] = draft.nodes;
  draft.nodes = draft.nodes.map(node => ({
    ...node,
    data:
      node.data.kind === 'input'
        ? { ...node.data, camera: 'sky01' }
        : node.data.kind === 'footage'
          ? { ...node.data, day, from: '12:00:00', until: '13:00:00' }
          : node.data.kind === 'model'
            ? { ...node.data, modelKey: 'detector/v1' }
            : node.data.kind === 'schedule'
              ? { ...schedule, ...change }
              : node.data,
  }));
  draft.edges = [
    workflowEdge(clock.id, input.id),
    workflowEdge(input.id, footage.id),
    workflowEdge(footage.id, detector.id),
    workflowEdge(detector.id, output.id),
  ];
  return { draft, bucket };
}
const messages = (
  { draft, bucket }: { draft: WorkflowDraft; bucket: WorkshopBucket },
  workflows: WorkflowDraft[] = [],
) => validateWorkflow(draft, [model], [cameraArchive, bucket], workflows).map(issue => issue.message);

it('connects a schedule only into the input bucket, and only once', () => {
  const { draft } = scheduled('Nightly');
  const [input, footage, , , clock] = draft.nodes,
    rest = draft.edges.slice(1);
  expect(canConnect(connection(clock.id, input.id), draft.nodes, rest)).toBe(true);
  expect(canConnect(connection(clock.id, footage.id), draft.nodes, rest)).toBe(false);
  const loose = addStep(draft, 'model', { x: 0, y: 400 }).nodes.at(-1)!; // unconnected, so only the input rule can refuse it
  expect(canConnect(connection(loose.id, input.id), [...draft.nodes, loose], rest)).toBe(false);
  expect(canConnect(connection(clock.id, input.id), draft.nodes, draft.edges)).toBe(false);
});
it('accepts a moving recorded day and rejects a fixed one on a scheduled workflow', () => {
  expect(messages(scheduled('Moving'))).toEqual([]);
  expect(messages(scheduled('Fixed', {}, '2026-09-23'))).toContain(
    'A scheduled workflow would process the same recorded day every time. Choose Day of each run or Day before each run.',
  );
});
it('waits for a same-day window to upload and requires days and a time', () => {
  expect(messages(scheduled('Early', { at: '13:05' }, 'run-day'))).toContain(
    'Schedule at 13:10 UTC or later so the whole window has been recorded and uploaded.',
  );
  expect(messages(scheduled('Late', { at: '13:10' }, 'run-day'))).toEqual([]);
  expect(messages(scheduled('No days', { days: [] }))).toContain('Choose the days and UTC time for this schedule.');
});
it('flags workflows that would start each other in a loop', () => {
  const a = scheduled('A'),
    b = scheduled('B');
  const follow = (w: WorkflowDraft, workflowId: string) => ({
    ...w,
    nodes: w.nodes.map(n =>
      n.data.kind === 'schedule' ? { ...n, data: { ...n.data, trigger: 'workflow' as const, workflowId } } : n,
    ),
  });
  const first = follow(a.draft, b.draft.id),
    second = follow(b.draft, a.draft.id);
  expect(messages({ ...a, draft: first }, [first, b.draft])).toEqual([]);
  expect(messages({ ...b, draft: second }, [first, second])).toContain(
    'These workflows would start each other in a loop.',
  );
});
it('loads a saved document that contains a schedule', () => {
  const { draft, bucket } = scheduled('Saved');
  const restored = restoreWorkshop({ version: 3, workflows: [draft], buckets: [cameraArchive, bucket] });
  expect(restored.workflows[0].nodes.map(node => node.data.kind)).toContain('schedule');
});
it('finds the next set-time slot on a chosen weekday', () => {
  const thursday = new Date('2026-09-24T14:00:00Z');
  expect(nextSlot({ ...schedule, days: [4] }, thursday)?.toISOString()).toBe('2026-10-01T13:30:00.000Z');
  expect(nextSlot({ ...schedule, days: [4, 5] }, thursday)?.toISOString()).toBe('2026-09-25T13:30:00.000Z');
});
it('edits days and the only-if check, and shows the last scheduler outcome', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schedules: [
              {
                workflow_id: 'flow',
                trigger_key: 'k',
                status: 'skipped',
                message: 'Nothing new to process.',
                run_id: null,
                checked_at: '2026-09-24T13:30:00Z',
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
  const onChange = vi.fn();
  render(
    <ScheduleFields
      workflowId="flow"
      workflows={[]}
      data={{ ...schedule, days: [1] }}
      onChange={onChange}
      screen="overview"
      onNavigate={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: 'Monday' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ days: [1, 5] }));
  fireEvent.click(screen.getByRole('switch', { name: 'Only if there is footage to process' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ onlyIf: true }));
  expect(await screen.findByText(/Skipped: Nothing new to process\./)).toBeTruthy();
});
function recordings(start: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.startsWith('/api/availability')
              ? { days: [start.slice(0, 10)] }
              : { segments: [{ start, duration_s: 60, size: 30_000_000, object_key: 'k' }] },
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
}
it('previews a relative recorded day without crashing on its recordings', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  recordings(`${yesterday}T12:00:00.000Z`);
  render(
    <FootageFields
      camera="sky01"
      data={{
        kind: 'footage',
        label: 'Footage',
        day: 'previous-day',
        from: '12:00:00',
        until: '13:00:00',
        interval: 5,
      }}
      onChange={() => {}}
      screen="overview"
      onNavigate={() => {}}
    />,
  );
  expect(await screen.findByText(/1 clips · ~12 images on/)).toBeTruthy();
  expect(screen.getByText('Day before each run')).toBeTruthy();
});
it('limits the footage filter once the workflow has a schedule', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  recordings(`${yesterday}T12:00:00.000Z`);
  const footage = { kind: 'footage' as const, label: 'Footage', from: '12:00:00', until: '13:00:00', interval: 5 };
  const days = async (scheduled?: ScheduleStep) => {
    render(
      <FootageFields
        camera="sky01"
        schedule={scheduled}
        data={{ ...footage, day: 'previous-day' }}
        onChange={() => {}}
        screen="recordedDay"
        onNavigate={() => {}}
      />,
    );
    await act(() => new Promise(resolve => setTimeout(resolve, 50))); // let the recorded dates load
    const names = within(screen.getByRole('list', { name: 'Recorded days' }))
      .getAllByRole('button')
      .map(button => button.querySelector('span span')?.textContent);
    cleanup();
    return names;
  };
  expect(await days()).toHaveLength(3); // two moving days plus the recorded date
  expect(await days(schedule)).toEqual(['Day of each run', 'Day before each run']);
  render(
    <FootageFields
      camera="sky01"
      schedule={schedule}
      data={{ ...footage, day: yesterday }}
      onChange={() => {}}
      screen="overview"
      onNavigate={() => {}}
    />,
  );
  expect((await screen.findAllByRole('alert')).map(alert => alert.textContent).join()).toContain(
    'This workflow has a schedule. Choose Day of each run or Day before each run.',
  );
  cleanup();
  const onChange = vi.fn();
  render(
    <FootageFields
      camera="sky01"
      schedule={schedule}
      data={{ ...footage, day: 'run-day' }}
      onChange={onChange}
      screen="timeRange"
      onNavigate={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Until'), { target: { value: '13:25:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply range' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'End by 13:20:00 UTC so the window uploads before the 13:30 UTC schedule.',
  );
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Until'), { target: { value: '13:15:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply range' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ until: '13:15:00' }));
});
