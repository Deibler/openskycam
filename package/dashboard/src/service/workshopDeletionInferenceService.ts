import type { Env } from '../models/applicationSharedmodel';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { WorkshopDeletionKind, WorkshopDeletionPreview } from '../models/workshopDeletionInferencemodel';
import type { WorkshopState } from '../models/workshopInferencemodel';
import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { loadWorkshop } from './workshopInferenceService';
import { identifier, invalid, validateDocument } from './workshopValidationInferenceService';
import * as ops from '../db/WorkshopDeletionInferenceOps';

function target(state: WorkshopState, kind: WorkshopDeletionKind, id: string) {
  if (!identifier(id)) invalid('Invalid Workshop ID.');
  const entry =
    kind === 'workflow'
      ? state.document.workflows.find(w => w.id === id)
      : state.document.buckets.find(b => b.id === id);
  if (!entry)
    throw new ApplicationError(
      'not_found',
      `${kind === 'workflow' ? 'Workflow' : 'Bucket'} not found. It may already have been deleted.`,
    );
  if (kind === 'bucket' && 'kind' in entry && entry.kind === 'raw')
    invalid('The camera archive is managed automatically and cannot be deleted here.');
  return entry;
}

export async function previewDeletion(
  env: Env,
  kind: WorkshopDeletionKind,
  id: string,
): Promise<WorkshopDeletionPreview> {
  const state = await loadWorkshop(env),
    entry = target(state, kind, id);
  return {
    kind,
    id,
    name: entry.name,
    revision: state.revision,
    linked_workflows:
      kind === 'bucket'
        ? state.document.workflows
            .filter(w => w.nodes.some(n => ['input', 'output'].includes(String(n.data.kind)) && n.data.bucketId === id))
            .map(w => ({ id: w.id, name: w.name }))
        : [],
    ...(await ops.deletionCounts(env, kind, id, new Date().toISOString())),
  };
}

export async function deleteWorkshopEntry(
  env: Env,
  kind: WorkshopDeletionKind,
  id: string,
  body: JsonObject,
): Promise<WorkshopState> {
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1)
    invalid('Confirm deletion using the current Workshop revision.');
  const state = await loadWorkshop(env);
  if (state.revision !== body.revision)
    throw new ApplicationError('conflict', 'Workshop changed. Reload and review the deletion again.');
  target(state, kind, id);
  const now = new Date().toISOString();
  const document = validateDocument({
    ...state.document,
    buckets: state.document.buckets.filter(b => kind !== 'bucket' || b.id !== id),
    workflows: state.document.workflows
      .filter(w => kind !== 'workflow' || w.id !== id)
      .map(w => {
        if (kind === 'workflow' && w.nodes.some(n => n.data.kind === 'schedule' && n.data.workflowId === id))
          return {
            ...w,
            updatedAt: now,
            nodes: w.nodes.map(n =>
              n.data.kind === 'schedule' && n.data.workflowId === id
                ? { ...n, data: { ...n.data, workflowId: '' } }
                : n,
            ),
          };
        if (
          kind !== 'bucket' ||
          !w.nodes.some(n => ['input', 'output'].includes(String(n.data.kind)) && n.data.bucketId === id)
        )
          return w;
        return {
          ...w,
          updatedAt: now,
          nodes: w.nodes.map(n =>
            ['input', 'output'].includes(String(n.data.kind)) && n.data.bucketId === id
              ? { ...n, data: { ...n.data, bucketId: '' } }
              : n,
          ),
        };
      }),
  });
  if (
    !(await ops.deleteEntry(
      env,
      kind,
      id,
      state.revision,
      JSON.stringify(document),
      now,
      new Date(Date.now() + 3600000).toISOString(),
    ))
  )
    throw new ApplicationError('conflict', 'Workshop changed. Reload and review the deletion again.');
  return { revision: state.revision + 1, document };
}
