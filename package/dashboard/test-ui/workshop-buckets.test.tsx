import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkshopDrafts } from '../ui/features/workshop/hooks/use-workshop-drafts';
import { readDrafts } from '../ui/features/workshop/service/workshopDraftInferenceService';
import { writeDrafts } from '../ui/features/workshop/db/WorkflowDraftInferenceOps';
import {
  cameraArchive,
  bucketUsage,
  createBucket,
  hasBucketCycle,
  renameBucket,
} from '../ui/features/workshop/service/bucketInferenceService';
import {
  addStep,
  canConnect,
  createWorkflow,
  validateWorkflow,
  workflowEdge,
} from '../ui/features/workshop/service/workflowInferenceService';
import { BucketPicker } from '../ui/features/workshop/components/bucket-picker';
import { BucketWorkspace } from '../ui/features/workshop/components/bucket-workspace';
import { NodeInspector } from '../ui/features/workshop/components/node-inspector';
import type { WorkshopCatalog } from '../ui/features/workshop/models/workflowInferencemodel';

const catalog: WorkshopCatalog = { models: [], overview: null, loading: false, error: '' };
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([1, 2])(
  'migrates schema %s archive and dataset endpoints without losing source settings, IDs, layout, or edges',
  version => {
    const draft = createWorkflow('Existing workflow');
    const legacy = {
      ...draft,
      viewport: { x: 40, y: -10, zoom: 0.8 },
      nodes: draft.nodes.map(node => ({
        ...node,
        data:
          node.data.kind === 'input'
            ? { kind: 'archive', label: 'Camera archive', camera: 'sky01' }
            : node.data.kind === 'output'
              ? { kind: 'dataset', label: 'Reviewed objects', datasetId: 'existing-dataset-id' }
              : node.data,
      })),
      edges: [workflowEdge(draft.nodes[0].id, draft.nodes[1].id)],
    };
    const raw = JSON.stringify({ version, workflows: [legacy] });
    localStorage.setItem('openskycam-workshop-v1', raw);
    const restored = readDrafts();
    expect(restored.error).toBe('');
    expect(restored.document.buckets).toMatchObject([
      cameraArchive,
      { id: 'existing-dataset-id', name: 'Reviewed objects', kind: 'labeled' },
    ]);
    const migrated = restored.document.workflows[0];
    expect(migrated.nodes[0]).toMatchObject({
      id: legacy.nodes[0].id,
      position: legacy.nodes[0].position,
      data: { kind: 'input', bucketId: cameraArchive.id, camera: 'sky01' },
    });
    expect(migrated.nodes[3]).toMatchObject({
      id: legacy.nodes[3].id,
      data: { kind: 'output', bucketId: 'existing-dataset-id' },
    });
    expect(migrated.edges).toEqual(legacy.edges);
    expect(migrated.viewport).toEqual(legacy.viewport);
    expect(localStorage.getItem('openskycam-workshop-v1')).toBe(raw);
    writeDrafts(restored.document);
    expect(readDrafts()).toEqual(restored);
  },
);

it('creates independent buckets and linked workflows atomically, then renames one shared reference everywhere', () => {
  const { result, unmount } = renderHook(useWorkshopDrafts);
  let bucketId = '',
    firstId = '',
    secondId = '';
  act(() => {
    const first = result.current.create('First pass');
    firstId = first.id;
    const output = first.nodes.find(node => node.data.kind === 'output')!;
    if (output.data.kind === 'output') bucketId = output.data.bucketId;
    const second = result.current.create('Refine objects', bucketId);
    secondId = second.id;
    result.current.editBucket(bucketId, 'Candidate objects', 'Images ready for another model');
  });
  const bucket = result.current.buckets.find(bucket => bucket.id === bucketId)!;
  expect(bucket.name).toBe('Candidate objects');
  expect(bucketUsage(bucketId, result.current.workflows)).toEqual({ writes: [firstId], reads: [secondId] });
  const second = result.current.workflows.find(workflow => workflow.id === secondId)!;
  expect(second.nodes.map(node => node.data.kind)).toEqual(['input', 'model', 'output']);
  expect(second.edges).toEqual([]);
  unmount();
  const saved = readDrafts();
  expect(saved.error).toBe('');
  expect(saved.document.buckets).toHaveLength(3);
  expect(bucketUsage(bucketId, saved.document.workflows)).toEqual({ writes: [firstId], reads: [secondId] });
});

it('keeps raw footage read-only and rejects ambiguous new bucket names', () => {
  const bucket = createBucket('Objects', [cameraArchive]);
  const document = { version: 3 as const, workflows: [], buckets: [cameraArchive, bucket] };
  expect(() => createBucket('  objects  ', document.buckets)).toThrow('already uses');
  expect(() => createBucket(' ', document.buckets)).toThrow('name');
  expect(() => renameBucket(document, cameraArchive.id, 'Archive', '')).toThrow('automatically');
  expect(() => renameBucket(document, bucket.id, cameraArchive.name, '')).toThrow('already uses');
});

it('accepts labeled bucket inputs directly into models or prediction checks while requiring raw footage extraction', () => {
  const bucket = createBucket('Candidates', [cameraArchive]);
  const buckets = [cameraArchive, bucket];
  const labeled = addStep(createWorkflow('Refine', bucket), 'condition', { x: 0, y: 400 }, 'class');
  const [input, model] = labeled.nodes;
  const condition = labeled.nodes.at(-1)!;
  const link = (target: string) => ({ source: input.id, target, sourceHandle: 'out', targetHandle: 'in' });
  expect(canConnect(link(model.id), labeled.nodes, [], buckets)).toBe(true);
  expect(canConnect(link(condition.id), labeled.nodes, [], buckets)).toBe(true);
  const raw = createWorkflow('From video');
  expect(
    canConnect(
      { source: raw.nodes[0].id, target: raw.nodes[2].id, sourceHandle: 'out', targetHandle: 'in' },
      raw.nodes,
      [],
      buckets,
    ),
  ).toBe(false);
  const withFilter = addStep(labeled, 'footage', { x: 400, y: 400 });
  expect(canConnect(link(withFilter.nodes.at(-1)!.id), withFilter.nodes, [], buckets)).toBe(false);
});

it('detects dependency loops across workflows and missing or raw output destinations', () => {
  const first = createBucket('First', [cameraArchive]),
    second = createBucket('Second', [cameraArchive, first]);
  const a = createWorkflow('A', second, first.id),
    b = createWorkflow('B', first, second.id);
  expect(hasBucketCycle(a, [a, b])).toBe(true);
  expect(hasBucketCycle(createWorkflow('Downstream', first, 'other-output'), [a, b])).toBe(true);
  expect(
    validateWorkflow(a, [], [cameraArchive, first, second], [a, b]).some(issue =>
      issue.message.includes('loop between buckets'),
    ),
  ).toBe(true);
  expect(hasBucketCycle(a, [a])).toBe(false);
  expect(hasBucketCycle(createWorkflow('Self', first, first.id), [])).toBe(true);
  expect(
    validateWorkflow(createWorkflow('Bad destination', cameraArchive, cameraArchive.id), []).some(issue =>
      issue.message.includes('labeled bucket for the output'),
    ),
  ).toBe(true);
});

it('keeps bucket choices in the node panel, with no dropdown or modal', () => {
  const bucket = createBucket('Candidates', [cameraArchive]);
  const choose = vi.fn();
  const workflow = createWorkflow('Classify', cameraArchive, bucket.id);
  render(
    <NodeInspector
      node={workflow.nodes[0]}
      camera=""
      catalog={catalog}
      buckets={[cameraArchive, bucket]}
      unavailableBuckets={[bucket.id]}
      onChange={choose}
      onCreateBucket={vi.fn()}
      onClose={vi.fn()}
      onRemove={vi.fn()}
      onOpenBucket={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Read from Camera archive' }));
  expect(screen.getByRole('button', { name: /Candidates/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Camera archive' }));
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ kind: 'input', bucketId: cameraArchive.id }));
});

it('offers reusable labeled sources but prevents writing raw archive data', () => {
  const bucket = createBucket('Candidates', [cameraArchive]),
    choose = vi.fn();
  const { rerender } = render(
    <BucketPicker
      buckets={[cameraArchive, bucket]}
      value={cameraArchive.id}
      direction="input"
      unavailable={[]}
      onChoose={choose}
      onCreate={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Candidates/ }));
  expect(choose).toHaveBeenCalledWith(bucket.id);
  rerender(
    <BucketPicker
      buckets={[cameraArchive, bucket]}
      value={bucket.id}
      direction="output"
      unavailable={[]}
      onChoose={choose}
      onCreate={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: /Camera archive/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'New labeled bucket' })).toBeTruthy();
});

it('opens a linked workflow and starts an unconnected workflow from a bucket; versions require reviewed images', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], versions: [], has_more: false }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
  const bucket = createBucket('Candidates', [cameraArchive]),
    workflow = createWorkflow('Find objects', cameraArchive, bucket.id);
  const open = vi.fn(),
    create = vi.fn();
  render(
    <BucketWorkspace
      onDelete={vi.fn()}
      bucket={bucket}
      workflows={[workflow]}
      catalog={catalog}
      onBack={vi.fn()}
      onWorkflow={open}
      onCreateWorkflow={create}
      onEdit={vi.fn()}
      onRecordings={vi.fn()}
    />,
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bucket details' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('button', { name: 'Find objects' }));
  expect(open).toHaveBeenCalledWith(workflow.id);
  fireEvent.click(screen.getByRole('button', { name: 'Use in workflow' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Workflow name' }), { target: { value: 'Refine' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create workflow' }));
  expect(create).toHaveBeenCalledWith('Refine', bucket.id);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Dataset versions' }), { button: 0, ctrlKey: false });
  expect((await screen.findByRole('button', { name: 'Create dataset version' })).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Source expiration still applies/)).toBeTruthy();
});
