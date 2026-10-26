import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConditionInspector } from '../ui/features/workshop/components/condition-inspector';
import { StepPalette } from '../ui/features/workshop/components/step-palette';
import {
  newCondition,
  conditionIssues,
  newConditionRule,
  ruleIssues,
  upstreamModel,
} from '../ui/features/workshop/service/conditionInferenceService';
import {
  addStep,
  canConnect,
  createWorkflow,
  usesTracking,
  validateWorkflow,
  workflowEdge,
} from '../ui/features/workshop/service/workflowInferenceService';
import { writeDrafts } from '../ui/features/workshop/db/WorkflowDraftInferenceOps';
import { readDrafts } from '../ui/features/workshop/service/workshopDraftInferenceService';
import { cameraArchive } from '../ui/features/workshop/service/bucketInferenceService';
import { arrangeWorkflow, findOpenPosition } from '../ui/features/workshop/utils/workflowLayoutInferenceUtil';
import type { ConditionStep } from '../ui/features/workshop/models/conditionInferencemodel';
import type { ModelVersion } from '../src/models/modelInferencemodel';

const detector: ModelVersion = {
  family: 'road',
  version: '1',
  name: 'Road detector',
  description: '',
  task: 'object-detection',
  adapter: 'ultralytics',
  classes: [{ id: 0, name: 'Car' }],
  input: {},
  artifacts: [],
  evaluations: [],
  caveats: [],
  dependencies: [],
};
function Settings({ initial = newCondition('time') }: { initial?: ConditionStep }) {
  const [data, setData] = useState(initial);
  return <ConditionInspector data={data} model={detector} onChange={setData} onClose={vi.fn()} onRemove={vi.fn()} />;
}
afterEach(cleanup);

it('migrates old checks without changing their values, graph IDs, ports, positions, or raw saved drafts', () => {
  const draft = addStep(createWorkflow('Existing draft'), 'condition', { x: 960, y: 280 });
  const condition = draft.nodes.at(-1)!;
  const legacy = {
    ...draft,
    nodes: draft.nodes.map(node =>
      node.id === condition.id
        ? {
            ...node,
            data: {
              kind: 'condition',
              label: 'Choose a path',
              field: 'time',
              from: '21:00',
              until: '05:00',
              threshold: 0.7,
              className: '',
            },
          }
        : node,
    ),
    edges: [workflowEdge(condition.id, draft.nodes[2].id, 'yes')],
  };
  legacy.edges[0].label = 'Yes';
  let raw = JSON.stringify({ version: 1, workflows: [legacy] });
  const original = raw;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const result = readDrafts(storage);
  expect(result.error).toBe('');
  expect(result.document.version).toBe(3);
  expect(result.document.workflows[0].nodes.at(-1)).toMatchObject({
    id: condition.id,
    position: condition.position,
    data: { match: 'all', rules: [{ kind: 'time', from: '21:00', until: '05:00', timeZone: 'UTC' }] },
  });
  expect(result.document.workflows[0].edges[0]).toEqual({ ...legacy.edges[0], label: 'Then' });
  expect(raw).toBe(original);
  writeDrafts(result.document, storage);
  expect(readDrafts(storage)).toEqual(result);
});

it('restores compound conditions and refuses malformed rules without overwriting the draft', () => {
  const draft = addStep(createWorkflow('Compound'), 'condition', { x: 0, y: 400 }, 'all');
  let raw = JSON.stringify({ version: 3, workflows: [draft], buckets: [cameraArchive] });
  const storage = { getItem: () => raw };
  expect(readDrafts(storage).document.workflows[0]).toEqual(draft);
  const condition = draft.nodes.at(-1)!.data as ConditionStep;
  condition.rules[1].id = condition.rules[0].id;
  raw = JSON.stringify({ version: 3, workflows: [draft], buckets: [cameraArchive] });
  expect(readDrafts(storage).error).toContain('left untouched');
  expect(storage.getItem()).toBe(raw);
});

it('accepts overnight windows but catches empty days, impossible times and invalid time zones', () => {
  expect(ruleIssues({ id: 'time', kind: 'time', from: '21:00', until: '05:00', timeZone: 'America/New_York' })).toEqual(
    [],
  );
  expect(ruleIssues({ id: 'time', kind: 'time', from: '25:00', until: '05:00', timeZone: 'local' })).toHaveLength(2);
  expect(ruleIssues({ id: 'weekday', kind: 'weekday', days: [], timeZone: 'UTC' })).toEqual([
    'Choose at least one day.',
  ]);
  expect(ruleIssues({ id: 'count', kind: 'count', count: -1, className: '', operator: 'equal' })).toHaveLength(1);
});

it('allows recording checks before frame sampling and requires labels for prediction checks', () => {
  const draft = addStep(createWorkflow('Typed checks'), 'condition', { x: 320, y: 400 }, 'weekday');
  const [source, footage] = draft.nodes,
    condition = draft.nodes.at(-1)!;
  const input = { source: source.id, target: condition.id, sourceHandle: 'out', targetHandle: 'in' };
  expect(canConnect(input, draft.nodes, [])).toBe(true);
  draft.edges = [workflowEdge(source.id, condition.id)];
  expect(
    canConnect(
      { source: condition.id, target: footage.id, sourceHandle: 'yes', targetHandle: 'in' },
      draft.nodes,
      draft.edges,
    ),
  ).toBe(true);
  condition.data = newCondition('confidence');
  expect(canConnect(input, draft.nodes, [])).toBe(false);
  expect(validateWorkflow(draft, []).some(issue => issue.message.includes('incompatible'))).toBe(true);
});

it('checks counts and class names against the model on this branch', () => {
  const draft = addStep(
    addStep(createWorkflow('Branch data'), 'condition', { x: 0, y: 300 }),
    'condition',
    { x: 0, y: 650 },
    'count',
  );
  const [, , model, , first, second] = draft.nodes;
  if (model.data.kind === 'model') model.data.modelKey = 'road/1';
  draft.edges = [workflowEdge(model.id, first.id), workflowEdge(first.id, second.id, 'yes')];
  expect(upstreamModel(draft, second.id, [detector])).toBe(detector);
  expect(conditionIssues(newCondition('count'), { ...detector, task: 'image-classification' })).toEqual([
    'Detection count needs an object detection model before this step.',
  ]);
  expect(
    conditionIssues(
      { ...newCondition(), rules: [{ id: 'class', kind: 'class', className: 'Bus', operator: 'present' }] },
      detector,
    )[0],
  ).toContain('not an output class');
});

it('adds a preset as a separate block and leaves existing graph positions and edges intact', () => {
  const add = vi.fn();
  render(<StepPalette onAdd={add} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Detection count' }));
  expect(add).toHaveBeenCalledWith('condition', 'count');
  const draft = createWorkflow('Manual');
  draft.edges = [workflowEdge(draft.nodes[0].id, draft.nodes[1].id)];
  const updated = addStep(draft, 'condition', { x: 0, y: 400 }, 'count');
  expect(updated.nodes.slice(0, -1)).toEqual(draft.nodes);
  expect(updated.edges).toBe(draft.edges);
  expect(updated.nodes.at(-1)!.data).toMatchObject({ rules: [{ kind: 'count' }] });
});

it('combines editable checks with All or Any and keeps forms contained', () => {
  render(<Settings />);
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confidence' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Confidence (%)' }), { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Car', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to condition' }));
  expect(screen.getByRole('button', { name: 'Car ≥ 85% confidence Per image' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Any check matches' }));
  expect(screen.getByRole('heading', { name: 'Any condition' })).toBeTruthy();
  expect(screen.getByText('No checks match')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Car ≥ 85% confidence Per image' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove check' }));
  expect(screen.getByRole('heading', { name: 'Time window' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Any check matches' })).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('edits weekdays and guards against leaving every day unselected', () => {
  render(
    <Settings
      initial={{ ...newCondition('weekday'), rules: [{ id: 'day', kind: 'weekday', days: [1], timeZone: 'UTC' }] }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recorded on Mon UTC' }));
  fireEvent.click(screen.getByRole('button', { name: 'Monday', exact: true }));
  expect(screen.getByText('Choose at least one day.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sunday', exact: true }));
  expect(screen.queryByText('Choose at least one day.')).toBeNull();
});

it('keeps taller multi-check blocks clear of other nodes when adding and arranging', () => {
  const draft = addStep(createWorkflow('Layout'), 'condition', { x: 0, y: 300 }, 'all');
  const condition = draft.nodes.at(-1)!;
  if (condition.data.kind === 'condition') condition.data.rules.push(newConditionRule('confidence'));
  condition.measured = { width: 264, height: 345 };
  const position = findOpenPosition([condition], { x: 0, y: 550 });
  expect(position.y).toBeGreaterThan(645);
  const stacked = { ...draft, nodes: [condition, ...draft.nodes.slice(0, 4)], edges: [] };
  expect(arrangeWorkflow(stacked).nodes[4].position.y).toBeGreaterThan(100 + 345);
});

it('routes on motion: a check per recording that needs a detection model and a tracking processor', () => {
  render(<Settings />);
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  fireEvent.click(screen.getByRole('button', { name: 'Motion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stays still' }));
  fireEvent.click(screen.getByRole('button', { name: 'Car', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to condition' }));
  expect(screen.getByRole('button', { name: 'Car stays still Across the recording' })).toBeTruthy();
  expect(conditionIssues(newCondition('motion'), { ...detector, task: 'image-classification' })).toEqual([
    'Motion needs an object detection model before this step.',
  ]);
  // A motion check, or frames kept by change, needs a processor that tracks; plain workflows do not.
  const draft = addStep(createWorkflow('Night'), 'condition', { x: 0, y: 400 }, 'class');
  expect(usesTracking(draft)).toBe(false);
  const footage = draft.nodes[1].data;
  if (footage.kind === 'footage') footage.pick = 'change';
  expect(usesTracking(draft)).toBe(true);
  if (footage.kind === 'footage') footage.pick = 'first';
  expect(usesTracking(addStep(draft, 'condition', { x: 0, y: 800 }, 'motion'))).toBe(true);
  // Drafts keep the choice and refuse a frame choice the server would reject.
  const storage = { getItem: () => JSON.stringify({ version: 3, workflows: [draft], buckets: [cameraArchive] }) };
  expect(readDrafts(storage).document.workflows[0]).toEqual(draft);
  if (footage.kind === 'footage') (footage as { pick: string }).pick = 'brightest';
  expect(readDrafts(storage).error).toContain('left untouched');
});

it('lists motion with the single checks and keeps All and Any as the ways to combine', () => {
  const add = vi.fn();
  render(<StepPalette onAdd={add} onClose={vi.fn()} />);
  const single = screen.getByRole('heading', { name: 'Check a condition' }),
    combine = screen.getByRole('heading', { name: 'Combine checks' });
  const motion = screen.getByRole('button', { name: 'Motion' });
  expect(single.compareDocumentPosition(motion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(combine.compareDocumentPosition(motion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  const any = screen.getByRole('button', { name: 'Any condition' });
  expect(combine.compareDocumentPosition(any) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(motion);
  expect(add).toHaveBeenCalledWith('condition', 'motion');
});
