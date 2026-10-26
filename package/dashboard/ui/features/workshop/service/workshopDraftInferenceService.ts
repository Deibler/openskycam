import { readStoredDrafts } from '../db/WorkflowDraftInferenceOps';
import type { DraftReadResult, WorkshopDocument, WorkflowStep } from '../models/workflowInferencemodel';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import { isConditionStep, migrateCondition } from '../utils/conditionInferenceUtil';
import { cameraArchive, uniqueBucketName } from './bucketInferenceService';

export const emptyWorkshop = (): WorkshopDocument => ({ version: 3, workflows: [], buckets: [{ ...cameraArchive }] });
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.length <= 1000;
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
function validStep(value: unknown): value is WorkflowStep {
  if (!object(value) || !text(value.label)) return false;
  switch (value.kind) {
    case 'input':
      return text(value.camera) && text(value.bucketId);
    case 'footage':
      return (
        text(value.day) &&
        text(value.from) &&
        text(value.until) &&
        numeric(value.interval) &&
        Number(value.interval) >= 1 &&
        (value.pick === undefined || ['first', 'change'].includes(String(value.pick)))
      );
    case 'model':
      return text(value.modelKey) && numeric(value.score) && Number(value.score) >= 0 && Number(value.score) <= 1;
    case 'condition':
      return isConditionStep(value);
    case 'output':
      return text(value.bucketId);
    case 'nothing':
      return true;
    case 'schedule':
      return (
        ['time', 'arrival', 'workflow'].includes(String(value.trigger)) &&
        Array.isArray(value.days) &&
        value.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) &&
        text(value.at) &&
        text(value.workflowId) &&
        typeof value.onlyIf === 'boolean'
      );
    default:
      return false;
  }
}
/** Upgrade decoded browser drafts in memory. Reading never overwrites the stored original. */
export function restoreWorkshop(value: unknown): WorkshopDocument {
  if (
    !object(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
    !Array.isArray(value.workflows) ||
    value.workflows.length > 100
  )
    throw new Error('Unsupported drafts');
  const legacy = value.version === 1 || value.version === 2;
  const buckets: WorkshopBucket[] = legacy ? [{ ...cameraArchive }] : Array.isArray(value.buckets) ? value.buckets : [];
  if (buckets.length > 500 || !buckets.length) throw new Error('Invalid buckets');
  const bucketIds = new Set<string>();
  for (const bucket of buckets) {
    if (
      !object(bucket) ||
      !text(bucket.id) ||
      !bucket.id ||
      bucketIds.has(bucket.id) ||
      !text(bucket.name) ||
      !bucket.name.trim() ||
      !text(bucket.description) ||
      !['raw', 'labeled'].includes(bucket.kind)
    )
      throw new Error('Invalid bucket');
    if (
      bucket.kind === 'raw'
        ? bucket.id !== cameraArchive.id || bucket.createdAt !== null
        : !text(bucket.createdAt) || !Number.isFinite(Date.parse(bucket.createdAt!))
    )
      throw new Error('Invalid bucket provenance');
    bucketIds.add(bucket.id);
  }
  if (!buckets.some(bucket => bucket.id === cameraArchive.id && bucket.kind === 'raw'))
    throw new Error('Missing camera archive');
  const draftIds = new Set<string>();
  for (const draft of value.workflows) {
    if (
      !object(draft) ||
      !text(draft.id) ||
      draftIds.has(String(draft.id)) ||
      !text(draft.name) ||
      !text(draft.updatedAt) ||
      !Array.isArray(draft.nodes) ||
      !Array.isArray(draft.edges) ||
      draft.nodes.length > 100 ||
      draft.edges.length > 300
    )
      throw new Error('Invalid draft');
    draftIds.add(String(draft.id));
    const ids = new Set<string>();
    for (const node of draft.nodes) {
      if (object(node) && object(node.data)) {
        if (value.version === 1 && node.data.kind === 'condition')
          node.data = migrateCondition(node.data, String(node.id));
        if (legacy && object(node.data)) {
          const data = node.data;
          if (data.kind === 'archive')
            node.data = { kind: 'input', label: 'Input bucket', bucketId: cameraArchive.id, camera: data.camera };
          if (data.kind === 'dataset') {
            if (!text(data.datasetId) || !data.datasetId || data.datasetId === cameraArchive.id || !text(data.label))
              throw new Error('Invalid legacy dataset');
            if (!bucketIds.has(String(data.datasetId))) {
              buckets.push({
                id: String(data.datasetId),
                name: uniqueBucketName(String(data.label) || `${draft.name} output`, buckets),
                kind: 'labeled',
                description: '',
                createdAt: String(draft.updatedAt),
              });
              bucketIds.add(String(data.datasetId));
            }
            node.data = { kind: 'output', label: 'Output bucket', bucketId: data.datasetId };
          }
        }
      }
      if (
        !object(node) ||
        !text(node.id) ||
        ids.has(String(node.id)) ||
        node.type !== 'workshop' ||
        !validStep(node.data) ||
        !object(node.position) ||
        !numeric(node.position.x) ||
        !numeric(node.position.y)
      )
        throw new Error('Invalid step');
      ids.add(String(node.id));
    }
    for (const edge of draft.edges)
      if (
        !object(edge) ||
        !text(edge.id) ||
        !ids.has(String(edge.source)) ||
        !ids.has(String(edge.target)) ||
        !['out', 'yes', 'no'].includes(String(edge.sourceHandle)) ||
        edge.targetHandle !== 'in'
      )
        throw new Error('Invalid connection');
    if (value.version === 1)
      for (const edge of draft.edges) {
        if (edge.sourceHandle === 'yes') edge.label = 'Then';
        if (edge.sourceHandle === 'no') edge.label = 'Otherwise';
      }
    if (
      draft.viewport !== undefined &&
      (!object(draft.viewport) ||
        !numeric(draft.viewport.x) ||
        !numeric(draft.viewport.y) ||
        !numeric(draft.viewport.zoom) ||
        Number(draft.viewport.zoom) <= 0)
    )
      throw new Error('Invalid viewport');
  }
  if (buckets.length > 500) throw new Error('Too many buckets');
  return { version: 3, workflows: value.workflows, buckets } as WorkshopDocument;
}

export function readDrafts(storage?: Pick<Storage, 'getItem'>): DraftReadResult {
  try {
    const raw = readStoredDrafts(storage);
    return { document: raw ? restoreWorkshop(JSON.parse(raw)) : emptyWorkshop(), error: '' };
  } catch {
    return {
      document: emptyWorkshop(),
      error: 'Saved drafts could not be opened. They have been left untouched in this browser.',
    };
  }
}
