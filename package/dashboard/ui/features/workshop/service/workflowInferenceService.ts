import type { WorkshopBucket } from '../models/bucketInferencemodel';
import { cameraArchive, hasBucketCycle } from './bucketInferenceService';
import type { Connection } from '@xyflow/react';
import type {
  AddableStep,
  DataKind,
  StepKind,
  WorkflowDraft,
  WorkflowEdge,
  WorkflowIssue,
  WorkflowNode,
  WorkflowStep,
} from '../models/workflowInferencemodel';
import type { ConditionPreset } from '../models/conditionInferencemodel';
import type { ModelVersion } from '../../../../src/models/modelInferencemodel';
import { modelKey } from '../../../lib/model-library';
import { conditionIssues, newCondition, upstreamModel } from './conditionInferenceService';
import { requiresPredictions } from '../utils/conditionInferenceUtil';
import {
  arrivalMinutes,
  clock,
  followLoop,
  isRelativeDay,
  minutesOf,
  uploadGraceMinutes,
} from '../utils/scheduleInferenceUtil';

export function newStep(kind: StepKind): WorkflowStep {
  switch (kind) {
    case 'input':
      return { kind, label: 'Input bucket', bucketId: cameraArchive.id, camera: '' };
    case 'footage':
      return { kind, label: 'Choose footage', day: '', from: '', until: '', interval: 5 };
    case 'model':
      return { kind, label: 'Run a model', modelKey: '', score: 0.5 };
    case 'condition':
      return newCondition();
    case 'output':
      return { kind, label: 'Output bucket', bucketId: '' };
    case 'nothing':
      return { kind, label: 'Do nothing' };
    case 'schedule':
      return {
        kind,
        label: 'Schedule',
        trigger: 'time',
        days: [0, 1, 2, 3, 4, 5, 6],
        at: '',
        workflowId: '',
        onlyIf: false,
      };
  }
}
/** Whether running this workflow needs a processor that tracks objects: frames kept by change, or motion rules. */
export const usesTracking = (workflow: WorkflowDraft) =>
  workflow.nodes.some(
    ({ data }) =>
      (data.kind === 'footage' && data.pick === 'change') ||
      (data.kind === 'condition' && data.rules.some(rule => rule.kind === 'motion')),
  );
export function workflowEdge(source: string, target: string, sourceHandle = 'out'): WorkflowEdge {
  return {
    id: crypto.randomUUID(),
    source,
    target,
    sourceHandle,
    targetHandle: 'in',
    type: 'default',
    label: sourceHandle === 'yes' ? 'Then' : sourceHandle === 'no' ? 'Otherwise' : undefined,
  };
}
export function createWorkflow(
  name: string,
  inputBucket: WorkshopBucket = cameraArchive,
  outputBucketId = '',
): WorkflowDraft {
  const nodes: WorkflowNode[] = (
    inputBucket.kind === 'raw'
      ? (['input', 'footage', 'model', 'output'] as const)
      : (['input', 'model', 'output'] as const)
  ).map((kind, index) => ({
    id: crypto.randomUUID(),
    type: 'workshop',
    position: { x: index * 320, y: 100 },
    data:
      kind === 'input'
        ? { kind, label: 'Input bucket', bucketId: inputBucket.id, camera: '' }
        : kind === 'output'
          ? { kind, label: 'Output bucket', bucketId: outputBucketId }
          : newStep(kind),
    deletable: !['input', 'output'].includes(kind),
  }));
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled workflow',
    updatedAt: new Date().toISOString(),
    nodes,
    edges: [],
  };
}
export function outputKind(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  buckets: WorkshopBucket[] = [cameraArchive],
  visited = new Set<string>(),
): DataKind | null {
  if (visited.has(nodeId)) return null;
  visited.add(nodeId);
  const data = nodes.find(node => node.id === nodeId)?.data;
  const kind = data?.kind;
  if (data?.kind === 'input') {
    const bucket = buckets.find(bucket => bucket.id === data.bucketId);
    return bucket ? (bucket.kind === 'raw' ? 'video' : 'labels') : null;
  }
  if (kind === 'footage') return 'frames';
  if (kind === 'model' || kind === 'output') return 'labels';
  const input = edges
    .filter(edge => edge.target === nodeId)
    .map(edge => outputKind(edge.source, nodes, edges, buckets, new Set(visited)));
  return input.length && input.every(value => value === input[0]) ? input[0] : null;
}
export function canConnect(
  connection: Connection,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  buckets: WorkshopBucket[] = [cameraArchive],
): boolean {
  const source = nodes.find(node => node.id === connection.source),
    target = nodes.find(node => node.id === connection.target);
  if (
    !source ||
    !target ||
    source.id === target.id ||
    source.data.kind === 'output' ||
    source.data.kind === 'nothing' ||
    target.data.kind === 'schedule'
  )
    return false;
  // A schedule starts the workflow: its only connection is into the input bucket.
  if (source.data.kind === 'schedule' || target.data.kind === 'input')
    return (
      source.data.kind === 'schedule' &&
      target.data.kind === 'input' &&
      connection.sourceHandle === 'out' &&
      connection.targetHandle === 'in' &&
      !edges.some(edge => edge.source === source.id || edge.target === target.id)
    );
  if (
    connection.targetHandle !== 'in' ||
    !(source.data.kind === 'condition' ? ['yes', 'no'] : ['out']).includes(connection.sourceHandle ?? '')
  )
    return false;
  if (edges.some(edge => edge.source === source.id && edge.sourceHandle === connection.sourceHandle)) return false;
  // A branch can rejoin only at the output bucket. Operations have a single input.
  if (!['output', 'nothing'].includes(target.data.kind) && edges.some(edge => edge.target === target.id)) return false;
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    edges.filter(edge => edge.source === id).forEach(edge => visit(edge.target));
  };
  visit(target.id);
  if (reachable.has(source.id)) return false;
  const kind = outputKind(source.id, nodes, edges, buckets);
  if (target.data.kind === 'footage') return kind === 'video';
  if (target.data.kind === 'nothing') return kind !== null;
  if (target.data.kind === 'output') return kind === 'labels';
  if (target.data.kind === 'condition') return requiresPredictions(target.data) ? kind === 'labels' : kind !== null;
  return kind === 'frames' || kind === 'labels';
}
/** Adding a node never creates, replaces, or repairs the user's connections. */
export function addStep(
  workflow: WorkflowDraft,
  kind: AddableStep,
  position: WorkflowNode['position'],
  preset: ConditionPreset = 'time',
  id = crypto.randomUUID(),
): WorkflowDraft {
  const step: WorkflowNode = {
    id,
    type: 'workshop',
    position,
    data: kind === 'condition' ? newCondition(preset) : newStep(kind),
  };
  return { ...workflow, nodes: [...workflow.nodes, step] };
}
export function removeStep(workflow: WorkflowDraft, id: string): WorkflowDraft {
  if (workflow.nodes.some(node => node.id === id && ['input', 'output'].includes(node.data.kind))) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.filter(node => node.id !== id),
    edges: workflow.edges.filter(edge => edge.source !== id && edge.target !== id),
  };
}
export function validateWorkflow(
  workflow: WorkflowDraft,
  models: ModelVersion[],
  buckets: WorkshopBucket[] = [cameraArchive],
  workflows: WorkflowDraft[] = [],
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const schedules = workflow.nodes.filter(node => node.data.kind === 'schedule');
  const footage = workflow.nodes.find(node => node.data.kind === 'footage')?.data;
  if (schedules.length > 1) issues.push({ nodeId: schedules[1].id, message: 'Use one schedule per workflow.' });
  for (const node of workflow.nodes) {
    const data = node.data;
    const add = (message: string) => issues.push({ nodeId: node.id, message });
    if (!['input', 'schedule'].includes(data.kind) && !workflow.edges.some(edge => edge.target === node.id))
      add(`${data.label}: connect an input.`);
    if (!['output', 'nothing', 'schedule'].includes(data.kind) && !workflow.edges.some(edge => edge.source === node.id))
      add(`${data.label}: connect an output.`);
    if (data.kind === 'schedule') {
      if (!workflow.edges.some(edge => edge.source === node.id)) add('Connect the schedule to the input bucket.');
      if (data.trigger === 'time' && (!data.days.length || !data.at))
        add('Choose the days and UTC time for this schedule.');
      if (
        data.trigger === 'time' &&
        footage?.kind === 'footage' &&
        footage.day === 'run-day' &&
        footage.until &&
        data.at &&
        minutesOf(data.at) < minutesOf(footage.until) + uploadGraceMinutes
      ) {
        const earliest = minutesOf(footage.until) + uploadGraceMinutes;
        add(
          earliest >= 1440
            ? 'This window ends too late to finish uploading before midnight UTC. Use Day before each run.'
            : `Schedule at ${clock(earliest)} UTC or later so the whole window has been recorded and uploaded.`,
        );
      }
      if (data.trigger === 'arrival' && footage?.kind === 'footage' && footage.day && footage.day !== 'run-day')
        add('When new footage arrives takes recordings as they upload. Choose Day of each run in the footage filter.');
      const latest = 1440 - arrivalMinutes - uploadGraceMinutes;
      if (
        data.trigger === 'arrival' &&
        footage?.kind === 'footage' &&
        footage.until &&
        minutesOf(footage.until) > latest
      )
        add(
          `End the window by ${clock(latest)} UTC so its last clips upload before the day's final new-footage check.`,
        );
      if (
        data.trigger === 'workflow' &&
        !workflows.some(item => item.id === data.workflowId && item.id !== workflow.id)
      )
        add('Choose the workflow this one follows.');
      else if (data.trigger === 'workflow' && followLoop(workflow.id, data.workflowId, workflows))
        add('These workflows would start each other in a loop.');
    }
    if (data.kind === 'footage' && schedules.length && data.day && !isRelativeDay(data.day))
      add(
        'A scheduled workflow would process the same recorded day every time. Choose Day of each run or Day before each run.',
      );
    if (data.kind === 'input') {
      const bucket = buckets.find(bucket => bucket.id === data.bucketId);
      if (!bucket) add('Choose an available input bucket.');
      else if (bucket.kind === 'raw' && !data.camera) add('Choose a camera from the archive.');
    }
    if (data.kind === 'footage' && (!data.day || !data.from || !data.until || data.from >= data.until))
      add('Choose a recorded date and time range.');
    if (data.kind === 'model' && !models.some(model => modelKey(model) === data.modelKey))
      add('Choose an available model version.');
    if (data.kind === 'condition') {
      for (const [port, label] of [
        ['yes', 'Then'],
        ['no', 'Otherwise'],
      ])
        if (!workflow.edges.some(edge => edge.source === node.id && edge.sourceHandle === port))
          add(`Connect the ${label} branch.`);
      conditionIssues(data, upstreamModel(workflow, node.id, models)).forEach(add);
    }
    if (data.kind === 'output' && !buckets.some(bucket => bucket.id === data.bucketId && bucket.kind === 'labeled'))
      add('Choose a labeled bucket for the output.');
  }
  for (const edge of workflow.edges) {
    if (
      !canConnect(
        {
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? 'out',
          targetHandle: edge.targetHandle ?? 'in',
        },
        workflow.nodes,
        workflow.edges.filter(item => item.id !== edge.id),
        buckets,
      )
    )
      issues.push({ nodeId: edge.target, message: 'A connection has incompatible data or creates a cycle.' });
  }
  if (hasBucketCycle(workflow, workflows))
    issues.push({
      nodeId: workflow.nodes.find(node => node.data.kind === 'input')?.id,
      message: 'This input creates a loop between buckets. Choose a bucket outside this workflow’s output chain.',
    });
  return issues;
}
