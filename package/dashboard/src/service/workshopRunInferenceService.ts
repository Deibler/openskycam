import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
import type { ApiPrincipal } from '../models/credentialSharedmodel';
import type {
  WorkshopInput,
  WorkshopSnapshot,
  WorkshopProgress,
  WorkshopItem,
  WorkshopRunDetail,
} from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import * as runOps from '../db/WorkshopRunInferenceOps';

export function expectedSamples(input: WorkshopInput, snapshot: WorkshopSnapshot) {
  if (input.kind === 'image') return 1;
  if (input.kind !== 'video') return 0;
  return Math.min(input.sample_limit ?? Infinity, Math.ceil((input.until - input.from) / snapshot.interval));
}
/** The scheduled sample a frame at this offset belongs to. The processor computes the same slot. */
export function sampleSlot(input: { from: number }, snapshot: WorkshopSnapshot, offset: number) {
  return Math.floor((offset - input.from + 0.001) / snapshot.interval);
}
export async function runDetail(env: Env, id: string): Promise<WorkshopRunDetail> {
  const run = await ops.run(env, id);
  if (!run) throw new ApplicationError('not_found', 'Run not found.');
  const now = new Date().toISOString();
  const snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot;
  const rows = await runOps.jobs(env, id);
  const jobs = rows.map(j => {
    const p = JSON.parse(j.progress_json) as Partial<WorkshopProgress>;
    const expected = j.expected_images || expectedSamples(JSON.parse(j.input_json), snapshot);
    return {
      id: j.id,
      status: j.expires_at <= now && ['queued', 'leased'].includes(j.status) ? 'expired' : j.status,
      expected,
      processed: j.status === 'completed' ? expected : (p.processed ?? 0),
      error: j.error,
      progress: p.phase ? (p as WorkshopProgress) : null,
    };
  });
  const test = snapshot.mode === 'test';
  const expired = test && !!snapshot.preview_expires_at && snapshot.preview_expires_at <= now;
  const previews = expired ? [] : await runOps.previews(env, id, now, 101);
  const results = test ? [] : await runOps.results(env, id, now, 101);
  const allImages = [
    ...results.map(i => ({ ...i, image_url: `/api/workshop/items/${i.id}/image` })),
    ...previews.map(p => {
      const i = JSON.parse(p.item_json) as WorkshopItem;
      return { ...i, image_url: `/api/workshop/runs/${id}/previews/${i.id}/image` };
    }),
  ];
  const images = [...new Map(allImages.map(i => [i.id, i])).values()];
  const status = expired
    ? 'expired'
    : jobs.some(j => j.status === 'leased')
      ? 'running'
      : jobs.some(j => j.status === 'queued')
        ? 'queued'
        : jobs.some(j => j.status === 'failed')
          ? 'failed'
          : jobs.some(j => j.status === 'cancelled')
            ? 'cancelled'
            : jobs.some(j => j.status === 'expired')
              ? 'expired'
              : 'completed';
  return {
    id: run.id,
    name: run.name,
    workflow_id: run.workflow_id,
    mode: test ? 'test' : 'run',
    status,
    created_at: run.created_at,
    preview_expires_at: snapshot.preview_expires_at ?? null,
    requested_images: snapshot.image_limit ?? null,
    expected_images: snapshot.expected_images ?? jobs.reduce((n, j) => n + j.expected, 0),
    processed_images: jobs.reduce((n, j) => n + j.processed, 0),
    output_buckets: test ? [] : snapshot.output_buckets,
    workflow: snapshot.workflow,
    steps: snapshot.workflow.nodes.map(n => ({
      id: n.id,
      kind: String(n.data.kind),
      label:
        snapshot.models.find(m => m.node_id === n.id)?.model.name ??
        (test && n.data.kind === 'output'
          ? 'Temporary output'
          : n.data.kind === 'input' && snapshot.input_bucket === 'camera-archive'
            ? 'Camera archive'
            : String(n.data.label)),
    })),
    jobs,
    images: images.slice(0, 100),
    has_more: images.length > 100,
  };
}
export async function previewImage(env: Env, run: string, id: string) {
  const row = await runOps.preview(env, run, id, new Date().toISOString());
  if (!row) throw new ApplicationError('not_found', 'This temporary preview has expired or is unavailable.');
  const item = JSON.parse(row.item_json) as WorkshopItem;
  const image = await ops.image(env, item.object_key);
  if (!image) throw new ApplicationError('not_found', 'Preview image is unavailable.');
  return image;
}
/** A temporary preview (a test-run frame or a photo) for a data or agent key with its camera. */
export async function machinePreview(env: Env, principal: ApiPrincipal, run: string, id: string) {
  if (principal.scope !== 'footage:read' && principal.scope !== 'agent')
    throw new ApplicationError('forbidden', 'Use a read-only data key.');
  const row = await runOps.preview(env, run, id, new Date().toISOString());
  if (!row) throw new ApplicationError('not_found', 'This temporary preview has expired or is unavailable.');
  if (!principal.cameras.includes((JSON.parse(row.item_json) as WorkshopItem).cam))
    throw new ApplicationError('forbidden', 'This key cannot access that camera.');
  return previewImage(env, run, id);
}
