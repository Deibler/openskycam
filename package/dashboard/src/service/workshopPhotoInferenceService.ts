import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
import type { ApiPrincipal } from '../models/credentialSharedmodel';
import type { Workflow, WorkshopInput, WorkshopSnapshot } from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import { activeRuntime } from '../db/WorkshopScheduleInferenceOps';
import { canonicalModel } from '../utils/modelInferenceUtil';
import { requireApiCamera } from './credentialSharedService';
import { RETENTION_MS } from '../../../shared/src/utils/layoutStorageUtil';
import { loadWorkshop, photoWorkflowId } from './workshopInferenceService';
import { runDetail } from './workshopRunInferenceService';
import { hash, invalid } from './workshopValidationInferenceService';

// ponytail: a photo is a temporary preview for an hour; the recording itself keeps its own lifetime.
const photoLifetime = 3600000;

/**
 * Queue one still frame from a stored recording. It runs as a one-image Workshop test with no
 * model, so the processor decodes it through the same lease, upload, and checksum path as any run.
 */
export async function requestPhoto(env: Env, principal: ApiPrincipal, camera: unknown, at: unknown) {
  const cam = requireApiCamera(principal, typeof camera === 'string' ? camera : null);
  const time = typeof at === 'string' ? new Date(at) : null;
  if (!time || !Number.isFinite(+time))
    invalid('Give the photo time as an ISO 8601 UTC time, such as 2026-09-24T14:32:05Z.');
  const iso = time.toISOString();
  // The same camera and time within an hour reuse one photo instead of decoding it again. One that
  // failed, was cancelled or expired is made again under the next ID, so asking again works.
  let id = `photo_${(await sha256(`${cam}|${iso}|${Math.floor(Date.now() / photoLifetime)}`)).slice(0, 32)}`;
  while (await ops.run(env, id)) {
    if (!['failed', 'cancelled', 'expired'].includes((await runDetail(env, id)).status)) return id;
    id = `photo_${(await sha256(id)).slice(0, 32)}`;
  }
  const rows = await ops.recordings(
    env,
    cam,
    iso,
    new Date(+time + 1000).toISOString(),
    new Date(Date.now() - RETENTION_MS).toISOString(),
  );
  // The newest recording covering the time: clips overlap, and an older one can end between frames
  // (a 63.06 s clip at 8 fps has no frame at 63 s), which the processor fails.
  const recording = rows.findLast(
    r => Date.parse(r.start) <= +time && +time < Date.parse(r.start) + (r.duration_s ?? 0) * 1000,
  );
  if (!recording)
    throw new ApplicationError(
      'not_found',
      `No stored ${cam} recording covers ${iso}. Use footage days and footage list to find recorded times.`,
    );
  if (!hash(recording.sha256) || !recording.duration_s || recording.duration_s > 300)
    invalid('That recording has incomplete metadata.');
  const runtime = await activeRuntime(env);
  if (!runtime)
    throw new ApplicationError('unavailable', 'No Workshop processor has checked in, so nothing can decode the photo.');
  const created = new Date(),
    expires = new Date(+created + photoLifetime).toISOString();
  const offset = (+time - Date.parse(recording.start)) / 1000;
  const input: WorkshopInput = {
    kind: 'video',
    sample_limit: 1,
    recording,
    item: null,
    from: offset,
    until: Math.min(recording.duration_s, offset + 1),
  };
  const step = (id: string, data: Record<string, unknown>, x: number) => ({
    id,
    type: 'workshop' as const,
    position: { x, y: 0 },
    data,
  });
  const link = (source: string, target: string) => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
  });
  // The camera archive is the output only so the preview has a bucket that always exists.
  const workflow: Workflow = {
    id: photoWorkflowId,
    name: 'Photo',
    updatedAt: created.toISOString(),
    nodes: [
      step('input', { kind: 'input', label: 'Camera archive', bucketId: 'camera-archive', camera: cam }, 0),
      step(
        'frame',
        {
          kind: 'footage',
          label: 'Photo time',
          day: iso.slice(0, 10),
          from: iso.slice(11, 19),
          until: iso.slice(11, 19),
          interval: 1,
        },
        320,
      ),
      step('photo', { kind: 'output', label: 'Photo', bucketId: 'camera-archive' }, 640),
    ],
    edges: [link('input', 'frame'), link('frame', 'photo')],
  };
  const snapshot: WorkshopSnapshot = {
    schema_version: 1,
    mode: 'test',
    image_limit: 1,
    preview_expires_at: expires,
    expected_images: 1,
    workflow,
    models: [],
    runtime,
    input_bucket: 'camera-archive',
    output_buckets: ['camera-archive'],
    interval: 1,
    from: iso,
    until: new Date(+time + 1000).toISOString(),
  };
  let state = await loadWorkshop(env);
  // A Workshop never saved has no document row, and both the run and its frame are checked against one.
  if (!state.revision) {
    await ops.saveState(env, 0, JSON.stringify(state.document), created.toISOString());
    state = await loadWorkshop(env);
  }
  await ops.insertRun(
    env,
    {
      id,
      request_hash: await sha256(canonicalModel({ photo: cam, at: iso })),
      workflow_id: photoWorkflowId,
      name: `Photo · ${cam} · ${iso.slice(0, 19).replace('T', ' ')} UTC`,
      runtime_id: runtime.id,
      snapshot_json: canonicalModel(snapshot),
      created_at: created.toISOString(),
    },
    [
      {
        id: `${id}_0`,
        expected_images: 1,
        cam,
        input_json: JSON.stringify(input),
        expires_at: new Date(Math.min(Date.parse(recording.start) + RETENTION_MS, Date.parse(expires))).toISOString(),
      },
    ],
    state.revision,
  );
  if (!(await ops.run(env, id)))
    throw new ApplicationError('conflict', 'Workshop changed while the photo was being queued. Ask for it again.');
  return id;
}

/** A queued or finished photo, checked against the key's cameras. */
export async function photoDetail(env: Env, principal: ApiPrincipal, id: string) {
  if (!/^photo_[a-f0-9]{32}$/.test(id)) invalid('Use the photo_id returned when the photo was requested.');
  const detail = await runDetail(env, id);
  requireApiCamera(principal, String(detail.workflow.nodes.find(n => n.data.kind === 'input')?.data.camera ?? ''));
  return detail;
}
