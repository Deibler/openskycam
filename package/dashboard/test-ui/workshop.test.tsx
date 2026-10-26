import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  canConnect,
  createWorkflow,
  addStep,
  removeStep,
  validateWorkflow,
  workflowEdge,
} from '../ui/features/workshop/service/workflowInferenceService';
import { writeDrafts } from '../ui/features/workshop/db/WorkflowDraftInferenceOps';
import { readDrafts } from '../ui/features/workshop/service/workshopDraftInferenceService';
import { cameraArchive, createBucket } from '../ui/features/workshop/service/bucketInferenceService';
import { useWorkshopDrafts } from '../ui/features/workshop/hooks/use-workshop-drafts';
import { summarizeFootage } from '../ui/features/workshop/utils/footageInferenceUtil';
import { WorkshopOverview } from '../ui/features/workshop/components/workshop-overview';
import { newCondition } from '../ui/features/workshop/service/conditionInferenceService';
import type { ModelVersion } from '../src/models/modelInferencemodel';
import type { Segment } from '../ui/lib/types';

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
const connection = (source: string, target: string) => ({ source, target, sourceHandle: 'out', targetHandle: 'in' });
function connectedWorkflow(name: string) {
  const draft = createWorkflow(name);
  draft.edges = draft.nodes.slice(1).map((node, index) => workflowEdge(draft.nodes[index].id, node.id));
  return draft;
}
function branchedWorkflow() {
  const draft = addStep(addStep(createWorkflow('Branches'), 'condition', { x: 0, y: 300 }), 'model', {
    x: 320,
    y: 300,
  });
  const [source, footage, detector, output, condition, alternative] = draft.nodes;
  draft.edges = [
    workflowEdge(source.id, footage.id),
    workflowEdge(footage.id, condition.id),
    workflowEdge(condition.id, detector.id, 'yes'),
    workflowEdge(condition.id, alternative.id, 'no'),
    workflowEdge(detector.id, output.id),
    workflowEdge(alternative.id, output.id),
  ];
  return draft;
}
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    clear: () => stored.clear(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('starts disconnected and never wires or rewires nodes when adding steps', () => {
  const draft = createWorkflow('Manual connections');
  expect(draft.edges).toEqual([]);
  const standalone = addStep(draft, 'condition', { x: 160, y: 320 });
  expect(standalone.nodes).toHaveLength(5);
  expect(standalone.edges).toEqual([]);
  const connected = connectedWorkflow('Existing connections');
  const expanded = addStep(connected, 'model', { x: 320, y: 320 });
  expect(expanded.nodes.slice(0, 4)).toEqual(connected.nodes);
  expect(expanded.edges).toBe(connected.edges);
  expect(validateWorkflow(draft, [model]).some(issue => issue.message.includes('connect an input'))).toBe(true);
});
it('requires labeled output, rejects occupied ports and cycles, and preserves archive/output nodes', () => {
  const draft = connectedWorkflow('Review');
  const [source, footage, detector, output] = draft.nodes;
  expect(canConnect(connection(source.id, output.id), draft.nodes, [])).toBe(false);
  expect(canConnect(connection(footage.id, output.id), draft.nodes, [])).toBe(false);
  expect(canConnect(connection(detector.id, output.id), draft.nodes, [])).toBe(true);
  expect(canConnect(connection(footage.id, detector.id), draft.nodes, draft.edges)).toBe(false);
  expect(canConnect(connection(detector.id, footage.id), draft.nodes, draft.edges)).toBe(false);
  expect(removeStep(draft, source.id)).toEqual(draft);
  expect(removeStep(draft, output.id)).toEqual(draft);
});
it('validates manually connected Then and Otherwise paths merging at the dataset', () => {
  const branched = branchedWorkflow();
  const decision = branched.nodes.find(node => node.data.kind === 'condition')!;
  const output = branched.nodes.find(node => node.data.kind === 'output')!;
  expect(
    branched.edges
      .filter(edge => edge.source === decision.id)
      .map(edge => edge.sourceHandle)
      .sort(),
  ).toEqual(['no', 'yes']);
  expect(branched.edges.filter(edge => edge.target === output.id)).toHaveLength(2);
  const bucket = createBucket('Labels', [cameraArchive]);
  if (output.data.kind === 'output') output.data.bucketId = bucket.id;
  const configured = {
    ...branched,
    nodes: branched.nodes.map(node => ({
      ...node,
      data:
        node.data.kind === 'input'
          ? { ...node.data, camera: 'sky01' }
          : node.data.kind === 'footage'
            ? { ...node.data, day: '2026-09-24', from: '07:00', until: '22:00' }
            : node.data.kind === 'model'
              ? { ...node.data, modelKey: 'detector/v1' }
              : node.data,
    })),
  };
  expect(validateWorkflow(configured, [model], [cameraArchive, bucket])).toEqual([]);
  const noBranch = {
    ...configured,
    edges: configured.edges.filter(edge => !(edge.source === decision.id && edge.sourceHandle === 'no')),
  };
  expect(validateWorkflow(noBranch, [model]).some(issue => issue.message === 'Connect the Otherwise branch.')).toBe(
    true,
  );
  const alternative = configured.nodes.find(
    node => node.data.kind === 'model' && !noBranch.edges.some(edge => edge.target === node.id),
  )!;
  const skip = addStep(removeStep({ ...configured, edges: noBranch.edges }, alternative.id), 'nothing', {
    x: 640,
    y: 420,
  });
  const dropped = skip.nodes.at(-1)!;
  const edges = [...skip.edges, workflowEdge(decision.id, dropped.id, 'no')];
  expect(
    canConnect(
      { source: decision.id, target: dropped.id, sourceHandle: 'no', targetHandle: 'in' },
      skip.nodes,
      noBranch.edges,
    ),
  ).toBe(true);
  expect(validateWorkflow({ ...skip, edges }, [model], [cameraArchive, bucket])).toEqual([]);
});
it('flags class and score decisions that lack upstream model labels', () => {
  const branched = branchedWorkflow();
  const nodes = branched.nodes.map(node =>
    node.data.kind === 'condition' ? { ...node, data: newCondition('confidence') } : node,
  );
  expect(validateWorkflow({ ...branched, nodes }, [model]).some(issue => issue.message.includes('incompatible'))).toBe(
    true,
  );
});
it('restores graph positions, camera/model settings, destination, and viewport', () => {
  const draft = createWorkflow('Saved workflow');
  draft.viewport = { x: 40, y: 30, zoom: 0.7 };
  draft.nodes[0].position = { x: 112, y: -20 };
  const document = { version: 3 as const, workflows: [draft], buckets: [cameraArchive] };
  writeDrafts(document);
  expect(readDrafts()).toEqual({ document, error: '' });
});
it('preserves corrupt stored drafts and reports that new changes cannot be saved', () => {
  const raw = '{"version":999,"workflows":[]}';
  localStorage.setItem('openskycam-workshop-v1', raw);
  const { result } = renderHook(useWorkshopDrafts);
  expect(result.current.error).toContain('left untouched');
  act(() => result.current.create('New draft'));
  expect(localStorage.getItem('openskycam-workshop-v1')).toBe(raw);
});
it('retains sequential edits in the same event and reports quota failures', () => {
  const { result } = renderHook(useWorkshopDrafts);
  let id = '';
  act(() => {
    id = result.current.create('Draft').id;
  });
  act(() => {
    result.current.update(id, draft => ({ ...draft, name: 'Renamed' }));
    result.current.update(id, draft => ({ ...draft, viewport: { x: 5, y: 6, zoom: 0.9 } }));
  });
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(readDrafts().document.workflows[0]).toMatchObject({ name: 'Renamed', viewport: { x: 5, y: 6, zoom: 0.9 } });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  act(() => result.current.update(id, draft => ({ ...draft, name: 'Unsaved' })));
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(result.current.error).toContain('will be lost');
  expect(result.current.workflows[0].name).toBe('Unsaved');
});
it('counts actual selected coverage without double counting overlaps or filling gaps', () => {
  const segment = (second: number, duration_s: number): Segment => ({
    start: new Date(second * 1000).toISOString(),
    duration_s,
    size: 100,
    frames: null,
    codec: null,
    width: null,
    height: null,
    bitrate: null,
  });
  expect(summarizeFootage([segment(0, 20), segment(10, 20), segment(40, 10)], 5000, 45000, 5)).toMatchObject({
    seconds: 30,
    bytes: 300,
    samples: 6,
  });
});
it('creates a named workflow through a single concise form', () => {
  const create = vi.fn();
  render(
    <WorkshopOverview
      workflows={[]}
      buckets={[cameraArchive]}
      catalog={{ models: [], overview: null, loading: false, error: '' }}
      summary={null}
      onCreate={create}
      onOpen={vi.fn()}
      onReview={vi.fn()}
      onBucket={vi.fn()}
    />,
  );
  expect(screen.getAllByRole('button', { name: 'Create workflow' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Create workflow' }));
  const name = screen.getByRole('textbox', { name: 'Workflow name' });
  fireEvent.change(name, { target: { value: '  Road objects  ' } });
  fireEvent.submit(name.closest('form')!);
  expect(create).toHaveBeenCalledWith('Road objects');
  expect(screen.queryByRole('dialog')).toBeNull();
});
