import { modelKey } from '../../../lib/model-library';
import { formatAge } from '../../../lib/archive/format.js';
import type { WorkshopRunStatus, WorkshopSnapshot } from '../../../../src/models/workshopInferencemodel';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkshopCatalog } from '../models/workflowInferencemodel';

export type RunState = 'running' | 'queued' | 'errors' | 'cancelled' | 'expired' | 'complete';
export function runState(run: WorkshopRunStatus): RunState {
  return run.leased
    ? 'running'
    : run.queued
      ? 'queued'
      : run.failed
        ? 'errors'
        : run.cancelled
          ? 'cancelled'
          : run.expired
            ? 'expired'
            : 'complete';
}
export const runStateLabel: Record<RunState, string> = {
  running: 'Running',
  queued: 'Queued',
  errors: 'Finished with errors',
  cancelled: 'Cancelled',
  expired: 'Expired',
  complete: 'Complete',
};
export const isTest = (run: WorkshopRunStatus) => (JSON.parse(run.snapshot_json) as WorkshopSnapshot).mode === 'test';
/** "12 min ago" for the last day and a half, then the date. */
export function when(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  return seconds < 36 * 3600
    ? formatAge(seconds)
    : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** What a workflow reads, which models it runs, and which bucket each branch fills. */
export function workflowFacts(workflow: WorkflowDraft, buckets: WorkshopBucket[], models: WorkshopCatalog['models']) {
  const name = (id: string) => buckets.find(bucket => bucket.id === id)?.name;
  const input = workflow.nodes.find(node => node.data.kind === 'input')?.data;
  const outputs = workflow.nodes.flatMap(node => {
    if (node.data.kind !== 'output') return [];
    const edge = workflow.edges.find(edge => edge.target === node.id);
    const source = workflow.nodes.find(other => other.id === edge?.source)?.data;
    const when =
      source?.kind === 'condition' ? (edge?.sourceHandle === 'no' ? `Not ${source.label}` : source.label) : '';
    return [{ bucketId: node.data.bucketId, name: name(node.data.bucketId) ?? 'Choose a bucket', when }];
  });
  return {
    input:
      input?.kind === 'input'
        ? [name(input.bucketId) ?? 'Choose a bucket', input.camera].filter(Boolean).join(' · ')
        : 'No input',
    models: workflow.nodes.flatMap(({ data }) =>
      data.kind === 'model' ? [models.find(model => modelKey(model) === data.modelKey)?.name ?? data.label] : [],
    ),
    outputs,
  };
}
