import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import type { Env, MachineApp } from '../models/applicationSharedmodel';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type {
  WorkshopJob,
  WorkshopLease,
  WorkshopSnapshot,
  WorkshopInput,
  WorkshopFrame,
  WorkshopItem,
  WorkshopProgress,
  WorkshopPhase,
  WorkshopTrack,
} from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import * as runOps from '../db/WorkshopRunInferenceOps';
import { expectedSamples, sampleSlot } from './workshopRunInferenceService';
import { publishRun } from './workshopLiveInferenceService';
import { photoWorkflowId } from './workshopInferenceService';
import { readRecording } from './videoStorageService';
import * as models from '../db/ModelInferenceOps';
import { canonicalModel } from '../utils/modelInferenceUtil';
import { hash, identifier, invalid, record } from './workshopValidationInferenceService';
const now = () => new Date().toISOString();
const until = () => new Date(Date.now() + 300000).toISOString();
function authorize(app: MachineApp) {
  if (app.principal.scope !== 'workshop:run' || !app.principal.device_id)
    throw new ApplicationError('forbidden', 'A device-scoped Workshop key is required.');
  if (!app.env.WORKSHOP) throw new ApplicationError('unavailable', 'Workshop storage is not configured.');
}
export async function claim(app: MachineApp, body: JsonObject) {
  authorize(app);
  if (!identifier(body.runtime_id) || !hash(body.code_sha256))
    invalid('Supply the registered runtime and code fingerprint.');
  const runtime = await ops.runtime(app.env, body.runtime_id);
  if (!runtime || runtime.device_id !== app.principal.device_id || runtime.code_sha256 !== body.code_sha256)
    throw new ApplicationError('forbidden', 'Register this immutable runtime before claiming work.');
  await ops.seen(app.env, runtime.id, now());
  const job = await ops.claim(
    app.env,
    runtime.id,
    app.principal.cameras,
    app.principal.id,
    crypto.randomUUID(),
    now(),
    until(),
    photoWorkflowId,
  );
  if (!job) return { job: null };
  const run = (await ops.run(app.env, job.run_id))!;
  return {
    job: {
      ...job,
      input: JSON.parse(job.input_json) as WorkshopInput,
      snapshot: JSON.parse(run.snapshot_json) as WorkshopSnapshot,
    },
  };
}
async function leased(app: MachineApp, id: string, lease: WorkshopLease, completed = false) {
  authorize(app);
  const job = await ops.job(app.env, id);
  if (!job) throw new ApplicationError('not_found', 'Job not found.');
  if (!app.principal.cameras.includes(job.cam) || job.lease_owner !== app.principal.id)
    throw new ApplicationError('forbidden', 'This key cannot access that job.');
  if (
    job.expires_at <= now() ||
    job.generation !== Number(lease.generation) ||
    job.lease_token !== lease.lease_token ||
    ((!completed || job.status !== 'completed') &&
      (job.status !== 'leased' || !job.lease_until || job.lease_until <= now()))
  )
    throw new ApplicationError('conflict', 'The lease is no longer valid. Discard this attempt.');
  return job;
}
export async function heartbeat(app: MachineApp, id: string, body: WorkshopLease) {
  const j = await leased(app, id, body);
  if (!(await ops.renew(app.env, j, now(), until()))) throw new ApplicationError('conflict', 'Lease expired.');
  return { renewed: true };
}
export async function fail(app: MachineApp, id: string, body: JsonObject) {
  const j = await leased(app, id, {
    generation: body.generation,
    lease_token: body.lease_token,
  });
  if (!['download_failed', 'decode_failed', 'model_failed', 'processor_failed'].includes(String(body.error)))
    invalid('Unsupported failure code.');
  if (!(await ops.fail(app.env, j, now(), String(body.error))))
    throw new ApplicationError('conflict', 'Lease expired.');
  await publishRun(app.env, j.run_id);
  return { status: 'failed' };
}
export async function input(app: MachineApp, id: string, lease: WorkshopLease) {
  const j = await leased(app, id, lease),
    source = JSON.parse(j.input_json) as WorkshopInput;
  const value =
    source.kind === 'video'
      ? await readRecording(app.env, source.recording!.object_key)
      : await ops.image(app.env, source.item!.object_key);
  if (!value) throw new ApplicationError('not_found', 'Source media is no longer available.');
  return value;
}
export async function artifact(app: MachineApp, id: string, sha: string, lease: WorkshopLease) {
  const j = await leased(app, id, lease),
    run = (await ops.run(app.env, j.run_id))!,
    snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot;
  if (!snapshot.models.some(m => m.artifact_sha256 === sha))
    throw new ApplicationError('forbidden', 'This model is not required by the leased run.');
  const row = await models.findArtifact(app.env, sha);
  if (!row) throw new ApplicationError('not_found', 'Model artifact is unavailable.');
  return { body: await models.artifactStream(app.env, row), bytes: row.bytes };
}
const key = (j: WorkshopJob, sha: string, test = false) =>
  test ? `workshop-tests/${j.id}/${sha}.jpg` : `workshop/${j.expires_at}/${sha}.jpg`;
export async function upload(
  app: MachineApp,
  id: string,
  digest: string,
  lease: WorkshopLease,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const j = await leased(app, id, lease);
  if (
    !hash(digest) ||
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217 ||
    (await sha256(bytes.buffer)) !== digest
  )
    throw new ApplicationError('invalid_data', 'Expected a checksum-verified JPEG.');
  const run = (await ops.run(app.env, j.run_id))!;
  const test = (JSON.parse(run.snapshot_json) as WorkshopSnapshot).mode === 'test';
  const objectKey = key(j, digest, test);
  // Journal before writing bytes: interrupted and stale attempts remain eligible for cleanup.
  await ops.upload(app.env, {
    object_key: objectKey,
    job_id: j.id,
    generation: j.generation,
    sha256: digest,
    bytes: bytes.length,
    expires_at: j.expires_at,
  });
  await ops.putImage(app.env, objectKey, bytes, digest);
  await leased(app, id, lease);
  return { sha256: digest };
}
export async function complete(app: MachineApp, id: string, body: JsonObject) {
  const j = await leased(app, id, { generation: body.generation, lease_token: body.lease_token }, true);
  const run = (await ops.run(app.env, j.run_id))!,
    snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot,
    input = JSON.parse(j.input_json) as WorkshopInput;
  if (
    body.code_sha256 !== snapshot.runtime.code_sha256 ||
    !Array.isArray(body.frames) ||
    body.frames.length > 600 ||
    !Number.isInteger(body.sampled_frames) ||
    Number(body.sampled_frames) < 0 ||
    Number(body.sampled_frames) > 600
  )
    invalid('Invalid result provenance or sample count.');
  const expected = expectedSamples(input, snapshot);
  const dropped = snapshot.workflow.nodes.some(n => n.data.kind === 'nothing');
  // Slots the recorder skipped hold no frame. Older processors never send the list.
  const empty = body.empty_slots ?? [];
  if (
    !Array.isArray(empty) ||
    empty.some(
      (slot, i) =>
        !Number.isInteger(slot) ||
        Number(slot) < 0 ||
        Number(slot) >= expected ||
        (i > 0 && Number(slot) <= Number(empty[i - 1])),
    )
  )
    invalid('Invalid empty sample slots.');
  if (
    Number(body.sampled_frames) + empty.length !== expected ||
    body.frames.length > Number(body.sampled_frames) ||
    (!dropped && body.frames.length !== Number(body.sampled_frames))
  )
    invalid('The result must account for every sampled frame in this job.');
  const result = {
      code_sha256: body.code_sha256,
      sampled_frames: body.sampled_frames,
      ...(empty.length ? { empty_slots: empty } : {}),
      frames: body.frames,
    },
    digest = await sha256(canonicalModel(result));
  if (j.status === 'completed') {
    if (j.result_sha256 !== digest) throw new ApplicationError('conflict', 'A different result was already committed.');
    return { status: 'completed' };
  }
  const items = await materializeFrames(app, j, snapshot, input, body.frames);
  if (input.kind === 'video') {
    const taken = new Set(empty as number[]);
    for (const f of body.frames as unknown as WorkshopFrame[]) {
      const slot = sampleSlot(input, snapshot, f.offset);
      if (taken.has(slot)) invalid('Each sample slot holds at most one frame.');
      taken.add(slot);
    }
  }
  if (!(await ops.complete(app.env, j, digest, items, now(), snapshot.mode === 'test')))
    throw new ApplicationError('conflict', 'Lease changed before results were committed.');
  await publishRun(app.env, j.run_id);
  return { status: 'completed', images: items.length };
}

const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fraction = (v: unknown) => number(v) && v >= 0 && v <= 1;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const trackKeys = ['id', 'motion', 'speed', 'start', 'end', 'detections', 'clipped', 'path', 'scan'],
  scanKeys = ['fps', 'searched', 'seen', 'speed', 'first', 'last', 'samples'];
/** A frame's tracks as the processor sent them, or null when any is malformed. Times lie in the recording. */
function validTracks(value: unknown, job: string, duration: number): WorkshopTrack[] | null {
  if (!Array.isArray(value) || value.length > 1000 || canonicalModel(value).length > 512 * 1024) return null;
  const time = (v: unknown): v is number => number(v) && v >= 0 && v <= duration + 5,
    ids = new Set<string>();
  for (const t of value) {
    if (
      !record(t) ||
      Object.keys(t).some(k => !trackKeys.includes(k)) ||
      typeof t.id !== 'string' ||
      !t.id.startsWith(job + ':') ||
      !/^[1-9]\d{0,5}$/.test(t.id.slice(job.length + 1)) ||
      ids.has(t.id) ||
      !['moving', 'stationary', 'brief'].includes(String(t.motion)) ||
      !(t.speed === null || (number(t.speed) && t.speed >= 0)) ||
      !time(t.start) ||
      !time(t.end) ||
      t.start > t.end ||
      !Array.isArray(t.path) ||
      !t.path.length ||
      t.path.length > 4000 ||
      t.detections !== t.path.length ||
      t.path.some(
        p =>
          !Array.isArray(p) ||
          p.length !== 7 ||
          !time(p[0]) ||
          !p.slice(1, 5).every(fraction) ||
          !count(p[5]) ||
          !fraction(p[6]),
      ) ||
      (t.clipped !== undefined &&
        (!Array.isArray(t.clipped) ||
          !t.clipped.length ||
          t.clipped.some((c, i, all) => !['start', 'end'].includes(String(c)) || all.indexOf(c) !== i)))
    )
      return null;
    if (t.scan !== undefined) {
      const c = t.scan;
      if (
        !record(c) ||
        Object.keys(c).some(k => !scanKeys.includes(k)) ||
        !number(c.fps) ||
        c.fps <= 0 ||
        !count(c.searched) ||
        !count(c.seen) ||
        c.seen > c.searched ||
        !(c.speed === null || (number(c.speed) && c.speed >= 0)) ||
        !(c.first === null || time(c.first)) ||
        !(c.last === null || time(c.last)) ||
        !Array.isArray(c.samples) ||
        c.samples.length > 600 ||
        c.samples.some(
          p =>
            !Array.isArray(p) ||
            p.length !== 4 ||
            !time(p[0]) ||
            !((p[1] === null && p[2] === null) || (fraction(p[1]) && fraction(p[2]))) ||
            !number(p[3]),
        )
      )
        return null;
    }
    ids.add(t.id);
  }
  return value as WorkshopTrack[];
}

async function materializeFrames(
  app: MachineApp,
  j: WorkshopJob,
  snapshot: WorkshopSnapshot,
  input: WorkshopInput,
  frames: unknown[],
): Promise<WorkshopItem[]> {
  const items: WorkshopItem[] = [],
    seen = new Set<string>();
  for (const raw of frames) {
    if (
      !record(raw) ||
      !hash(raw.sha256) ||
      !snapshot.output_buckets.includes(String(raw.bucket_id)) ||
      !Number.isSafeInteger(raw.pts) ||
      Number(raw.pts) < 0 ||
      !Array.isArray(raw.time_base) ||
      raw.time_base.length !== 2 ||
      raw.time_base.some(n => !Number.isSafeInteger(n) || n <= 0) ||
      !Number.isInteger(raw.width) ||
      !Number.isInteger(raw.height) ||
      Number(raw.width) < 1 ||
      Number(raw.height) < 1 ||
      Number(raw.width) > 16384 ||
      Number(raw.height) > 16384 ||
      typeof raw.offset !== 'number' ||
      !Number.isFinite(raw.offset) ||
      !Array.isArray(raw.annotations) ||
      raw.annotations.length > 1000
    )
      invalid('Invalid labeled frame.');
    const f = raw as unknown as WorkshopFrame;
    // Tracks follow objects through a recording; a photo has none.
    const tracks =
      raw.tracks === undefined
        ? []
        : input.kind === 'video'
          ? validTracks(raw.tracks, j.id, input.recording!.duration_s ?? input.until)
          : null;
    if (!tracks) invalid('Invalid tracks.');
    const finalModel = snapshot.models.find(m => m.node_id === f.model_node);
    // Only photo runs have no model: their frames are plain stills with no labels.
    if (!finalModel && snapshot.models.length) invalid('A frame needs its final labeling model.');
    if (input.kind === 'video' && (f.offset < input.from - 0.001 || f.offset >= input.until + 0.05))
      invalid('Frame is outside the selected source window.');
    const sampleKey = `${f.pts}/${f.time_base.join('/')}`;
    if (seen.has(sampleKey)) invalid('Duplicate output frame.');
    seen.add(sampleKey);
    for (const a of f.annotations) {
      if (!record(a)) invalid('Invalid annotation.');
      const m = snapshot.models.find(m => m.node_id === a.model_node);
      if (
        !m ||
        a.model_node !== f.model_node ||
        !m.model.classes.some(c => c.id === a.class_id && c.name === a.class_name) ||
        typeof a.confidence !== 'number' ||
        !Number.isFinite(a.confidence) ||
        a.confidence < 0 ||
        a.confidence > 1
      )
        invalid('Annotation does not match the pinned model classes.');
      if (
        m.model.task === 'object-detection' &&
        (!Array.isArray(a.box) ||
          a.box.length !== 4 ||
          a.box.some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
          a.box[0] >= a.box[2] ||
          a.box[1] >= a.box[3])
      )
        invalid('Invalid normalized detection box.');
      if (a.track_id !== undefined && !tracks.some(t => t.id === a.track_id))
        invalid('A track_id must name one of the frame\'s tracks.');
    }
    if (tracks.some(t => !f.annotations.some(a => a.track_id === t.id)))
      invalid('Every track needs a box in the frame.');
    const original = input.item;
    if (original) {
      const p = JSON.parse(original.provenance_json);
      if (f.offset !== 0 || f.pts !== p.pts || f.time_base[0] !== p.time_base[0] || f.time_base[1] !== p.time_base[1])
        invalid('Preserve the source frame presentation time.');
    }
    const sourceHash = original?.source_sha256 ?? input.recording!.sha256;
    const asset =
      original?.asset_id ??
      (await sha256(
        canonicalModel({
          source_sha256: sourceHash,
          pts: f.pts,
          time_base: f.time_base,
          recipe: 'jpeg-v1',
        }),
      ));
    const objectKey = original ? original.object_key : key(j, f.sha256, snapshot.mode === 'test');
    if (original && original.sha256 !== f.sha256)
      invalid('Labeled inputs must reference their existing canonical image.');
    const head = await ops.imageHead(app.env, objectKey);
    if (
      !head ||
      (head.checksums.sha256 &&
        Array.from(new Uint8Array(head.checksums.sha256), b => b.toString(16).padStart(2, '0')).join('') !== f.sha256)
    )
      throw new ApplicationError('invalid_data', 'Upload the verified image before committing labels.');
    const annotation = canonicalModel(f.annotations),
      itemId = await sha256(
        canonicalModel({
          run: j.run_id,
          bucket: f.bucket_id,
          asset,
          annotation,
        }),
      );
    const provenance = {
      schema_version: 1,
      source: original ? JSON.parse(original.provenance_json) : input.recording,
      pts: f.pts,
      time_base: f.time_base,
      width: f.width,
      height: f.height,
      bytes: head.size,
      recipe: 'jpeg-v1',
      annotation_model: finalModel
        ? {
            family: finalModel.model.family,
            version: finalModel.model.version,
            classes: finalModel.model.classes,
            task: finalModel.model.task,
            node_id: finalModel.node_id,
          }
        : null,
      ...(tracks.length ? { tracks } : {}),
      runtime_id: snapshot.runtime.id,
      code_sha256: snapshot.runtime.code_sha256,
      model_versions: snapshot.models.map(m => ({
        node_id: m.node_id,
        family: m.model.family,
        version: m.model.version,
        sha256: m.artifact_sha256,
        confidence: m.confidence,
        imgsz: m.imgsz,
      })),
    };
    items.push({
      id: itemId,
      bucket_id: f.bucket_id,
      asset_id: asset,
      run_id: j.run_id,
      job_id: j.id,
      source_sha256: sourceHash,
      cam: j.cam,
      captured_at:
        original?.captured_at ?? new Date(Date.parse(input.recording!.start) + f.offset * 1000).toISOString(),
      object_key: objectKey,
      sha256: f.sha256,
      expires_at: j.expires_at,
      annotation_json: annotation,
      provenance_json: canonicalModel(provenance),
      review: 'pending',
      created_at: now(),
    });
  }
  return items;
}

export async function progress(app: MachineApp, id: string, body: JsonObject) {
  const j = await leased(app, id, { generation: body.generation, lease_token: body.lease_token });
  const run = (await ops.run(app.env, j.run_id))!;
  const snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot;
  const input = JSON.parse(j.input_json) as WorkshopInput;
  const expected = expectedSamples(input, snapshot);
  const previous = JSON.parse(j.progress_json) as Partial<WorkshopProgress>;
  if (
    !['downloading', 'loading_model', 'processing', 'uploading', 'finalizing'].includes(String(body.phase)) ||
    !Number.isInteger(body.processed) ||
    Number(body.processed) < 0 ||
    Number(body.processed) > expected ||
    (body.node_id !== null && !snapshot.workflow.nodes.some(n => n.id === body.node_id))
  )
    invalid('Invalid run progress.');
  let item: WorkshopItem | null = null;
  if (body.frame !== undefined) {
    if (
      !Number.isInteger(body.sequence) ||
      Number(body.sequence) !== Number(body.processed) - 1 ||
      (Number(body.sequence) !== (previous.processed ?? 0) && Number(body.processed) !== previous.processed)
    )
      invalid('Publish sampled frames in order.');
    item = (await materializeFrames(app, j, snapshot, input, [body.frame]))[0];
    if (
      input.kind === 'video' &&
      sampleSlot(input, snapshot, Number((body.frame as unknown as WorkshopFrame).offset)) !== body.sequence
    )
      invalid('Preview does not match its scheduled sample.');
  } else if (
    Number(body.processed) !== (previous.processed ?? 0) &&
    !(
      (body.empty === true || snapshot.workflow.nodes.some(n => n.id === body.node_id && n.data.kind === 'nothing')) &&
      Number(body.processed) > (previous.processed ?? 0)
    )
  )
    invalid('Progress requires a verified frame.');
  const value: WorkshopProgress = {
    phase: body.phase as WorkshopPhase,
    node_id: body.node_id as string | null,
    processed: Number(body.processed),
    updated_at: now(),
  };
  if (!(await runOps.progress(app.env, j, value, item, Number(body.sequence ?? 0), now())))
    throw new ApplicationError('conflict', 'Progress changed or the lease is no longer valid.');
  await publishRun(app.env, j.run_id);
  return { processed: value.processed };
}
