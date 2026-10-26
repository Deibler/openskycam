import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import { RETENTION_MS } from '../../../shared/src/utils/layoutStorageUtil';
import type { ApiPrincipal } from '../models/credentialSharedmodel';
import type { Env } from '../models/applicationSharedmodel';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { ModelVersion } from '../models/modelInferencemodel';
import type {
  WorkshopState,
  WorkshopRuntime,
  WorkshopSnapshot,
  WorkshopModel,
  WorkshopSeed,
  WorkshopInput,
  WorkshopVersionManifest,
  WorkshopItem,
  WorkshopRunOptions,
} from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import * as models from '../db/ModelInferenceOps';
import { canonicalModel } from '../utils/modelInferenceUtil';
import { cameraIds } from './cameraStorageService';
import { publishRun } from './workshopLiveInferenceService';
import {
  validateDocument,
  executionGraph,
  samplingWindow,
  invalid,
  noMedia,
  identifier,
  hash,
  record,
  usesTracking,
} from './workshopValidationInferenceService';
const now = () => new Date().toISOString();
// What each processor engine can run. v3 tracks objects across a recording: frames kept by change, motion rules.
const engines: Record<string, string[]> = {
  'workshop-v2': ['test-runs', 'live-progress'],
  'workshop-v3': ['test-runs', 'live-progress', 'tracking'],
};
const engineOf = (runtime: WorkshopRuntime) => String(JSON.parse(runtime.manifest_json).engine);
export async function loadWorkshop(env: Env): Promise<WorkshopState> {
  const stored = await ops.state(env);
  return stored
    ? { revision: stored.revision, document: JSON.parse(stored.document_json) }
    : {
        revision: 0,
        document: {
          version: 3,
          workflows: [],
          buckets: [
            {
              id: 'camera-archive',
              name: 'Camera archive',
              kind: 'raw',
              description: 'Original video from your cameras.',
              createdAt: null,
            },
          ],
        },
      };
}
export async function saveWorkshop(env: Env, body: JsonObject) {
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) invalid('A document revision is required.');
  const document = validateDocument(body.document),
    previous = await loadWorkshop(env);
  if (previous.revision !== body.revision)
    throw new ApplicationError(
      'conflict',
      'Workshop changed in another window. Reload before saving; your browser copy is preserved.',
    );
  if (previous.document.buckets.some(b => !document.buckets.some(next => next.id === b.id && next.kind === b.kind)))
    invalid('Existing buckets cannot be removed or change kind.');
  if (previous.document.workflows.some(w => !document.workflows.some(next => next.id === w.id)))
    invalid('Use the workflow deletion action to remove a workflow and cancel its unfinished runs.');
  const serialized = JSON.stringify(document);
  if (new TextEncoder().encode(serialized).length > 750000) invalid('Workshop is too large.');
  if (!(await ops.saveState(env, Number(body.revision), serialized, now())))
    throw new ApplicationError('conflict', 'Workshop changed in another window. Reload before saving.');
  return { revision: Number(body.revision) + 1, document };
}
export async function runtimeStatus(env: Env) {
  return {
    runtimes: (await ops.runtimes(env)).map(runtime => {
      const { manifest_json, ...r } = runtime;
      return { ...r, capabilities: engines[engineOf(runtime)] ?? [] };
    }),
    enabled: !!env.WORKSHOP,
  };
}
export async function registerRuntime(env: Env, body: JsonObject) {
  if (!hash(body.code_sha256) || !identifier(body.device_id) || !(await models.findDevice(env, body.device_id)))
    invalid('Register a device and provide the processor code SHA-256.');
  const manifest = {
    schema_version: 1,
    engine: 'workshop-v3',
    device_id: body.device_id,
    code_sha256: body.code_sha256,
  };
  const serialized = canonicalModel(manifest),
    id = `workshop-${(await sha256(serialized)).slice(0, 32)}`;
  const runtime: WorkshopRuntime = {
    id,
    device_id: String(body.device_id),
    code_sha256: String(body.code_sha256),
    manifest_json: serialized,
    created_at: now(),
    last_seen_at: null,
  };
  await ops.registerRuntime(env, runtime);
  return (await ops.runtime(env, id))!;
}
export async function createRun(env: Env, body: JsonObject, options: WorkshopRunOptions = {}) {
  if (!env.WORKSHOP) throw new ApplicationError('unavailable', 'Workshop processing storage is not configured.');
  if (
    !identifier(body.id) ||
    !identifier(body.workflow_id) ||
    !identifier(body.runtime_id) ||
    !Number.isSafeInteger(body.revision)
  )
    invalid('Choose a saved workflow and registered runtime.');
  const mode = body.mode ?? 'run';
  if (mode !== 'test' && mode !== 'run') invalid('Choose test or run mode.');
  if (
    mode === 'test' &&
    (!Number.isInteger(body.image_limit) || Number(body.image_limit) < 1 || Number(body.image_limit) > 100)
  )
    invalid('A test processes between 1 and 100 images.');
  if (mode === 'run' && body.image_limit !== undefined) invalid('Image limits belong to test runs.');
  const limit = mode === 'test' ? Number(body.image_limit) : 2000;
  const previewExpiry = new Date(Date.now() + 3600000).toISOString();
  const requestHash = await sha256(canonicalModel(body)),
    existing = await ops.run(env, String(body.id));
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new ApplicationError('conflict', 'This run ID has already been used.');
    return existing;
  }
  const state = await loadWorkshop(env);
  if (state.revision !== body.revision)
    throw new ApplicationError('conflict', 'Save and reload the latest workflow before running.');
  const workflow = state.document.workflows.find(w => w.id === body.workflow_id);
  if (!workflow) invalid('Workflow not found.');
  const { input, outputs, footage } = executionGraph(workflow);
  const runtime = await ops.runtime(env, String(body.runtime_id));
  if (!runtime) invalid('Register this processor runtime first.');
  const capabilities = engines[engineOf(runtime)] ?? [];
  if (mode === 'test' && !capabilities.includes('test-runs'))
    invalid('Update the Workshop processor before submitting tests.');
  if (usesTracking(workflow) && !capabilities.includes('tracking'))
    invalid('Update the Workshop processor: this workflow keeps frames by change or routes on motion.');
  const selected: WorkshopModel[] = [];
  for (const node of workflow.nodes.filter(n => n.data.kind === 'model')) {
    const [family, version, ...rest] = String(node.data.modelKey).split('/');
    const row = !rest.length && family && version ? await models.findModel(env, family, version) : null;
    if (!row) invalid('A selected model version is unavailable.');
    const model = JSON.parse(row.manifest_json) as ModelVersion;
    const issue = workshopModelIssue(model);
    if (issue) invalid(issue);
    const artifact = model.artifacts.find(a => a.filename.endsWith('.pt'));
    if (!artifact || !(await models.findArtifact(env, artifact.sha256)))
      invalid(`The weights for ${model.name} are unavailable.`);
    const size = Number(
      model.input.width ??
        model.input.imgsz ??
        (Array.isArray(model.input.training_size) ? model.input.training_size[0] : model.input.training_size) ??
        640,
    );
    const imgsz = Number.isInteger(size) && size >= 32 && size <= 2048 ? Math.ceil(size / 32) * 32 : 640;
    selected.push({
      node_id: node.id,
      model,
      artifact_sha256: artifact.sha256,
      imgsz,
      confidence: Number(node.data.score),
    });
  }
  if (!selected.length || selected.length > 4) invalid('Choose between one and four supported models.');
  const window = footage ? samplingWindow(footage.data, options.now) : null,
    interval = footage ? Number(footage.data.interval) : 1;
  const snapshot: WorkshopSnapshot = {
    schema_version: 1,
    mode,
    ...(mode === 'test' ? { image_limit: limit, preview_expires_at: previewExpiry } : {}),
    workflow,
    models: selected,
    runtime,
    input_bucket: String(input.data.bucketId),
    output_buckets: outputs.map(n => String(n.data.bucketId)),
    interval,
    ...(footage?.data.pick === 'change' ? { pick: 'change' as const } : {}),
    from: window?.from ?? null,
    until: window?.until ?? null,
  };
  const seeds: WorkshopSeed[] = [];
  const created = now();
  let estimated = 0;
  if (window) {
    const camera = String(input.data.camera);
    if (!cameraIds(env).includes(camera)) invalid('Choose an available camera.');
    const rows = await ops.recordings(
      env,
      camera,
      window.from,
      window.until,
      new Date(Date.now() - RETENTION_MS).toISOString(),
      options.since === undefined ? undefined : { after: options.since ?? '', until: created },
    );
    if (mode === 'run' && rows.length > 100) invalid('Use a smaller window: one run can contain up to 100 recordings.');
    for (const row of rows) {
      if (mode === 'test' && estimated >= limit) break;
      if (!hash(row.sha256) || !row.duration_s || row.duration_s > 300)
        invalid('A recording has incomplete metadata or exceeds five minutes.');
      const from = Math.max(0, (Date.parse(window.from) - Date.parse(row.start)) / 1000),
        until = Math.min(row.duration_s, (Date.parse(window.until) - Date.parse(row.start)) / 1000);
      // Whole slots only. A partial last slot can end before the recording's last frame starts:
      // a 57.03 s clip at 8 fps has no frame at 57 s, and the processor would drop the whole clip.
      const slots = Math.floor((until - from) / interval);
      if (slots < 1) continue;
      const sampleLimit = mode === 'test' ? Math.min(limit - estimated, slots) : slots;
      estimated += sampleLimit;
      const source: WorkshopInput = {
        kind: 'video',
        sample_limit: sampleLimit,
        recording: row,
        item: null,
        from,
        until,
      };
      seeds.push({
        id: `${body.id}_${seeds.length}`,
        expected_images: sampleLimit,
        cam: camera,
        input_json: JSON.stringify(source),
        expires_at: new Date(
          Math.min(Date.parse(row.start) + RETENTION_MS, mode === 'test' ? Date.parse(previewExpiry) : Infinity),
        ).toISOString(),
      });
    }
  } else {
    const items = await ops.inputItems(
      env,
      String(input.data.bucketId),
      created,
      mode === 'test' ? limit : 2001,
      options.since === undefined ? '' : (options.since ?? ''),
      input.data.includeRejected === true,
    );
    if (items.length > 2000) invalid('This runner accepts up to 2,000 labeled input images per run.');
    for (const item of items) {
      const source: WorkshopInput = {
        kind: 'image',
        recording: null,
        item,
        from: 0,
        until: 0,
      };
      seeds.push({
        id: `${body.id}_${seeds.length}`,
        expected_images: 1,
        cam: item.cam,
        input_json: JSON.stringify(source),
        expires_at: mode === 'test' && previewExpiry < item.expires_at ? previewExpiry : item.expires_at,
      });
    }
    estimated = items.length;
  }
  if (!seeds.length) invalid(noMedia);
  if (estimated > 2000)
    invalid('This window exceeds 2,000 sampled images. Increase the sampling interval or choose a smaller window.');
  snapshot.expected_images = estimated;
  const r = {
    id: String(body.id),
    request_hash: requestHash,
    workflow_id: workflow.id,
    name: options.name ?? workflow.name,
    runtime_id: runtime.id,
    snapshot_json: canonicalModel(snapshot),
    created_at: created,
  };
  await ops.insertRun(env, r, seeds, state.revision);
  const saved = await ops.run(env, r.id);
  if (!saved)
    throw new ApplicationError('conflict', 'Workshop changed while preparing the run. Reload before running.');
  if (saved.request_hash !== requestHash) throw new ApplicationError('conflict', 'Run ID conflict.');
  return saved;
}
/** Why this runner cannot use a model version, or null when it can. */
export function workshopModelIssue(model: ModelVersion) {
  if (
    model.adapter !== 'ultralytics' ||
    !['object-detection', 'image-classification'].includes(model.task) ||
    !model.classes.length
  )
    return `${model.name} needs a verified runtime adapter or class mapping.`;
  // Crop-trained classifiers and tile-trained detectors need explicit preprocessing nodes.
  if (
    /tiled|crop/i.test(model.name) ||
    model.input.kind === 'crop' ||
    (record(model.input.legacy_runtime) && model.input.legacy_runtime.prefers_tiling === true)
  )
    return `${model.name} requires tiling or crops. Choose a full-frame model for this runner.`;
  if (!model.artifacts.some(a => a.filename.endsWith('.pt'))) return `The weights for ${model.name} are unavailable.`;
  return null;
}
// Not a valid workflow ID, so no saved workflow can share it.
export const photoWorkflowId = '@photo';
/** Workflow runs, newest first, optionally for one workflow. Agent photos are runs too, but they are not shown with workflows. */
export const listRuns = (env: Env, workflow: string | null = null) =>
  ops.listRuns(env, photoWorkflowId, now(), { workflow });
export async function cancelRun(env: Env, id: string) {
  if (!(await ops.run(env, id))) throw new ApplicationError('not_found', 'Run not found.');
  await ops.cancel(env, id);
  await publishRun(env, id);
  return { cancelled: true };
}
export async function bucketContents(env: Env, id: string) {
  if (!(await loadWorkshop(env)).document.buckets.some(b => b.id === id))
    throw new ApplicationError('not_found', 'Bucket not found.');
  const rows = await ops.items(env, id, now());
  return {
    items: rows.slice(0, 500).map(publicItem),
    has_more: rows.length > 500,
    accepted: (await ops.bucketCounts(env, now())).find(bucket => bucket.bucket_id === id)?.accepted ?? 0,
    versions: await ops.versions(env, id, now()),
  };
}
function publicItem(i: WorkshopItem) {
  return {
    ...i,
    annotations: JSON.parse(i.annotation_json),
    image_url: `/api/workshop/items/${i.id}/image`,
  };
}
/** How long a browser may keep a photo or its thumbnail: a day, and never past the photo's expiry. */
export const browserCacheSeconds = (expiresAt: string) =>
  Math.max(0, Math.min(86400, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));

/** A photo for the website, with how long the browser may keep it. Photo bytes never change. */
export async function websiteImage(env: Env, id: string) {
  const item = await ops.item(env, id, now());
  const image = item && (await ops.image(env, item.object_key));
  if (!item || !image) throw new ApplicationError('not_found', 'Image expired or missing.');
  return { body: image.body, maxAge: browserCacheSeconds(item.expires_at) };
}

export async function readImage(env: Env, id: string) {
  const item = await ops.item(env, id, now());
  if (!item) throw new ApplicationError('not_found', 'Image expired or missing.');
  const image = await ops.image(env, item.object_key);
  if (!image) throw new ApplicationError('not_found', 'Image bytes are no longer available.');
  return image;
}
export async function createVersion(env: Env, bucket: string, body: JsonObject) {
  if (!identifier(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100)
    invalid('Provide a version ID and name.');
  if (body.include_rejected !== undefined && typeof body.include_rejected !== 'boolean')
    invalid('include_rejected must be true or false.');
  const previous = await ops.version(env, body.id);
  if (previous) {
    if (previous.bucket_id !== bucket || previous.name !== body.name.trim())
      throw new ApplicationError('conflict', 'Version ID conflict.');
    const { manifest, available, ...metadata } = await readVersion(env, body.id);
    return { ...metadata, images: manifest.items.length };
  }
  const assets = new Set<string>(),
    selected = (await ops.reviewedItems(env, bucket, now(), body.include_rejected === true)).filter(i => {
      if (assets.has(i.asset_id)) return false;
      assets.add(i.asset_id);
      return true;
    });
  if (!selected.length) invalid('Accept some labeled images before creating a version.');
  // No per-image storage check: cleanup never deletes bytes a live item references, and a check per image
  // took over five minutes from Singapore for 7,471 images (each a round trip to storage in eastern North America).
  const entries: WorkshopVersionManifest['items'] = [];
  for (const i of selected) {
    const group = parseInt((await sha256(`${i.cam}/${i.captured_at.slice(0, 10)}`)).slice(0, 8), 16) % 100;
    entries.push({
      item_id: i.id,
      cam: i.cam,
      media_path: `/v1/workshop/items/${i.id}/image`,
      asset_id: i.asset_id,
      sha256: i.sha256,
      source_sha256: i.source_sha256,
      captured_at: i.captured_at,
      expires_at: i.expires_at,
      review: i.review as 'accepted' | 'rejected',
      annotations: JSON.parse(i.annotation_json),
      provenance: JSON.parse(i.provenance_json),
      split: group < 80 ? 'train' : group < 90 ? 'validation' : 'test',
    });
  }
  const tasks = new Set(entries.map(e => (e.provenance.annotation_model as { task: string }).task));
  if (tasks.size !== 1)
    invalid('A dataset version needs one task. Separate detection and classification outputs into different buckets.');
  const classes = [
    ...new Set(
      entries.flatMap(e => (e.provenance.annotation_model as { classes: { name: string }[] }).classes.map(c => c.name)),
    ),
  ].sort();
  for (const entry of entries)
    entry.annotations = entry.annotations.map(a => ({
      ...a,
      model_class_id: a.class_id,
      class_id: classes.indexOf(a.class_name),
    }));
  const created = now(),
    manifest: WorkshopVersionManifest = {
      schema_version: 1,
      bucket_id: bucket,
      class_names: classes,
      split_policy:
        'camera + UTC capture day; SHA-256 modulo 100; 80/10/10. Entire days stay together; small versions may contain only one split.',
      created_at: created,
      items: entries,
    };
  const { items, ...header } = manifest,
    v = {
      id: body.id,
      bucket_id: bucket,
      name: body.name.trim(),
      manifest_json: canonicalModel(header),
      sha256: await sha256(canonicalModel(manifest)),
      created_at: created,
    };
  if (
    !(await ops.insertVersion(env, v, items, now()))
  )
    throw new ApplicationError('conflict', 'Images changed or expired during version creation. Refresh and try again.');
  const { manifest_json, ...metadata } = v;
  return { ...metadata, images: items.length };
}
export async function readVersion(env: Env, id: string) {
  const v = await ops.versionManifest(env, id);
  // Every version has an item; none means a row written without its items, which is not a dataset.
  if (!v?.items.length) throw new ApplicationError('not_found', 'Version not found.');
  const manifest = {
    ...JSON.parse(v.manifest_json),
    items: v.items.map(i => JSON.parse(i)),
  } as WorkshopVersionManifest;
  if (manifest.items.some(i => i.expires_at <= now()))
    throw new ApplicationError('not_found', 'This dataset version has expired with its source images.');
  const { manifest_json, items, ...metadata } = v;
  return { ...metadata, manifest, available: true };
}
export async function cleanupWorkshop(env: Env) {
  if (!env.WORKSHOP) return;
  for (const upload of await ops.expiredUploads(env, now())) await ops.removeUpload(env, upload.object_key);
  await ops.purgeExpiredLabels(env, now());
}
/** Save a verified frame, labels and provenance; the source video keeps its original lifetime. */
export async function saveItem(env: Env, id: string) {
  const item = await ops.item(env, id, now());
  if (!item) throw new ApplicationError('not_found', 'Image expired or missing.');
  if (item.object_key.startsWith('retained/')) return { saved: true };
  const source = await ops.image(env, item.object_key);
  if (!source) throw new ApplicationError('not_found', 'Source image is no longer available.');
  const objectKey = `retained/${crypto.randomUUID()}/${item.sha256}.jpg`;
  const attemptExpiry = new Date(Date.now() + 3600000).toISOString();
  await ops.upload(env, {
    object_key: objectKey,
    job_id: item.job_id,
    generation: 0,
    sha256: item.sha256,
    bytes: source.size,
    expires_at: attemptExpiry,
  });
  await ops.copyRetained(env, objectKey, source.body, item.sha256);
  const verified = await ops.imageHead(env, objectKey);
  if (!verified || verified.size !== source.size)
    throw new ApplicationError('unavailable', 'Retained image verification failed.');
  const provenance = {
    ...JSON.parse(item.provenance_json),
    saved_at: now(),
    source_expires_at: item.expires_at,
    retention_scope: 'image, labels, and provenance; original video not included',
  };
  if (!(await ops.retainItem(env, item, objectKey, canonicalModel(provenance), '9999-12-31T23:59:59.999Z', now()))) {
    const latest = await ops.item(env, id, now());
    if (!latest?.object_key.startsWith('retained/'))
      throw new ApplicationError('conflict', 'Image expired or changed before it could be saved.');
  }
  return { saved: true };
}

export async function machineVersion(env: Env, principal: ApiPrincipal, id: string) {
  if (principal.scope !== 'footage:read' && principal.scope !== 'agent')
    throw new ApplicationError('forbidden', 'Use a read-only data key.');
  const version = await readVersion(env, id);
  if (version.manifest.items.some(i => !principal.cameras.includes(i.cam)))
    throw new ApplicationError('forbidden', 'This key cannot access every camera in this version.');
  return version;
}
export async function machineImage(env: Env, principal: ApiPrincipal, id: string) {
  if (principal.scope !== 'footage:read' && principal.scope !== 'agent')
    throw new ApplicationError('forbidden', 'Use a read-only data key.');
  const item = await ops.item(env, id, now());
  if (!item) throw new ApplicationError('not_found', 'Image expired or missing.');
  if (!principal.cameras.includes(item.cam))
    throw new ApplicationError('forbidden', 'This key cannot access that camera.');
  return readImage(env, id);
}
