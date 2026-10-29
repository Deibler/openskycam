import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, it, expect } from 'vitest';
import { accessToken, minutesAgo, seedSegment } from './helpers';
import { sha256 } from '../../shared/src/utils/cryptoSharedUtil';
import type {
  WorkshopDocument,
  WorkshopJob,
  WorkshopItem,
  WorkshopVersionManifest,
  WorkshopVersionSummary,
  WorkshopState,
  WorkshopRun,
  WorkshopRunReview,
  WorkshopRunStatus,
  WorkshopSummary,
} from '../src/models/workshopInferencemodel';
import type { WorkshopDeletionPreview } from '../src/models/workshopDeletionInferencemodel';
import { browserCacheSeconds, cleanupWorkshop } from '../src/service/workshopInferenceService';
import { inputItems } from '../src/db/WorkshopInferenceOps';
import * as workshopOps from '../src/db/WorkshopInferenceOps';
import { deleteEntry } from '../src/db/WorkshopDeletionInferenceOps';
import { executionGraph } from '../src/service/workshopValidationInferenceService';
import { bucketThumbnail } from '../src/service/bucketBrowseInferenceService';
import { keepThumbnail } from '../src/db/BucketBrowseInferenceOps';
import { thumbnailCrop, thumbnailFile, thumbnailKey } from '../src/utils/thumbnailInferenceUtil';
import { runSchedules } from '../src/service/workshopScheduleInferenceService';
import { canonicalModel } from '../src/utils/modelInferenceUtil';
// One base for the whole file: minutesAgo() rounds to the minute, so recomputing it per setup would give
// two setups the same start whenever the clock crosses a minute between them.
// Setups count back a minute each, and a footage window cannot cross midnight, so early in the UTC day
// they count back from the previous day's last whole window instead.
const recent = minutesAgo(20),
  midnight = new Date(recent).setUTCHours(0, 0, 0, 0);
const seedBase = +recent - midnight < 3 * 3_600_000 ? new Date(midnight - 120_000) : recent;
let seedNumber = 0;
const code = 'd'.repeat(64),
  modelHash = 'c'.repeat(64),
  sourceHash = 'b'.repeat(64);
async function web(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return exports.default.fetch(
    new Request('https://openskycam.test' + path, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': await accessToken({
          email: 'workshop@example.test',
        }),
        Origin: 'https://openskycam.test',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
async function api(token: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return exports.default.fetch(
    new Request('https://api.example.com/v1/workshop' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}
async function setup(
  options: {
    mode?: 'test' | 'run';
    image_limit?: number;
    interval?: number;
    input?: object;
    durationS?: number;
    body?: Uint8Array;
    footage?: Record<string, unknown>;
  } = {},
) {
  const suffix = crypto.randomUUID(),
    device = 'device.' + suffix; // a dot, which device IDs allow
  await web('/api/models/devices', { id: device });
  const runtimeResponse = await web('/api/workshop/runtimes', {
    device_id: device,
    code_sha256: code,
  });
  expect(runtimeResponse.status).toBe(201);
  const runtime = await runtimeResponse.json<{ id: string }>();
  const key = await web('/api/keys', {
    name: 'Workshop ' + suffix,
    cameras: ['sky01'],
    expires_in_days: 1,
    scope: 'workshop:run',
    device_id: device,
  });
  expect(key.status).toBe(201);
  const credential = await key.json<{ token: string; key: { id: string } }>();
  const state = await (await web('/api/workshop')).json<{ revision: number; document: WorkshopDocument }>();
  const start = new Date(+seedBase - 60_000 * seedNumber++),
    end = new Date(+start + 60_000);
  await seedSegment({ start, durationS: options.durationS, body: options.body });
  await env.CATALOG.prepare('UPDATE segments SET sha256=? WHERE start=?').bind(sourceHash, start.toISOString()).run();
  const family = 'model-' + suffix;
  const model = {
    family,
    version: 'v1',
    name: 'Full frame model',
    description: 'Test',
    task: 'object-detection',
    adapter: 'ultralytics',
    input: options.input ?? { width: 640 },
    classes: [
      { id: 0, name: 'Object' },
      { id: 1, name: 'Bird' },
    ],
    artifacts: [{ sha256: modelHash, bytes: 3, filename: 'weights.pt', format: 'pt' }],
    dependencies: [],
    evaluations: [],
    caveats: [],
  };
  await env.CATALOG.prepare('INSERT INTO model_versions VALUES(?,?,?,?)')
    .bind(family, 'v1', JSON.stringify(model), new Date().toISOString())
    .run();
  await env.CATALOG.prepare('INSERT OR IGNORE INTO model_artifacts VALUES(?,?,?,NULL,?)')
    .bind(modelHash, 3, 'test/model.pt', new Date().toISOString())
    .run();
  await env.MODELS.put('test/model.pt', new Uint8Array([1, 2, 3]));
  const bucket = 'bucket-' + suffix,
    wf = 'flow-' + suffix;
  state.document.buckets.push({
    id: bucket,
    kind: 'labeled',
    name: bucket,
    description: '',
    createdAt: new Date().toISOString(),
  });
  const data = [
    {
      kind: 'input',
      label: 'Input',
      bucketId: 'camera-archive',
      camera: 'sky01',
    },
    {
      kind: 'footage',
      label: 'Frames',
      day: start.toISOString().slice(0, 10),
      from: start.toISOString().slice(11, 19),
      until: end.toISOString().slice(11, 19),
      interval: options.interval ?? 60,
      ...options.footage,
    },
    { kind: 'model', label: 'Model', modelKey: family + '/v1', score: 0.5 },
    { kind: 'output', label: 'Output', bucketId: bucket },
  ];
  state.document.workflows.push({
    id: wf,
    name: wf,
    updatedAt: new Date().toISOString(),
    nodes: data.map((d, i) => ({
      id: 'n' + i,
      type: 'workshop',
      position: { x: 0, y: 0 },
      data: d,
    })),
    edges: [0, 1, 2].map(i => ({
      id: 'e' + i,
      source: 'n' + i,
      target: 'n' + (i + 1),
      sourceHandle: 'out',
      targetHandle: 'in',
    })),
  });
  expect((await web('/api/workshop', state, 'PUT')).status).toBe(200);
  const request = {
    id: crypto.randomUUID(),
    workflow_id: wf,
    runtime_id: runtime.id,
    revision: state.revision + 1,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.image_limit ? { image_limit: options.image_limit } : {}),
  };
  const response = await web('/api/workshop/runs', request);
  expect(response.status, await response.clone().text()).toBe(201);
  const claim = () =>
    api(credential.token, '/claim', {
      runtime_id: runtime.id,
      code_sha256: code,
    });
  return {
    bucket,
    request,
    token: credential.token,
    // Test users are capped at 20 active keys; a test that adds a setup revokes its key when done.
    revoke: async () => expect((await web(`/api/keys/${credential.key.id}`, undefined, 'DELETE')).status).toBe(200),
    claim,
    runtime,
    start,
    state,
  };
}
const lease = (j: WorkshopJob) => ({
  generation: j.generation,
  lease_token: j.lease_token,
});
// Frame i sits `step` seconds after frame i-1; the server accepts at most one frame per sample slot.
async function commit(s: Awaited<ReturnType<typeof setup>>, job: WorkshopJob, count = 1, finish = true, step = 5) {
  const jpeg = new Uint8Array([255, 216, 1, 2, 255, 217]),
    digest = await sha256(jpeg.buffer);
  const put = await exports.default.fetch(
    new Request(`https://api.example.com/v1/workshop/jobs/${job.id}/images/${digest}`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + s.token,
        'X-Lease-Token': job.lease_token!,
        'X-Lease-Generation': String(job.generation),
      },
      body: jpeg,
    }),
  );
  expect(put.status).toBe(200);
  const body = {
    ...lease(job),
    code_sha256: code,
    sampled_frames: count,
    frames: [
      {
        bucket_id: s.bucket,
        model_node: 'n2',
        sha256: digest,
        pts: 0,
        time_base: [1, 30],
        offset: 0,
        width: 640,
        height: 480,
        annotations: [
          {
            class_id: 0,
            class_name: 'Object',
            confidence: 0.8,
            box: [0.1, 0.2, 0.3, 0.4],
            model_node: 'n2',
          },
        ],
      },
    ],
  };
  body.frames = Array.from({ length: count }, (_, i) => ({ ...body.frames[0], pts: i * step * 30, offset: i * step }));
  if (!finish) return body;
  const result = await api(s.token, `/jobs/${job.id}/complete`, body);
  expect(result.status, await result.clone().text()).toBe(200);
  return body;
}
describe('bucket detection library', () => {
  it('filters the whole bucket and pages beyond 500 without duplicating equal capture times', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    await env.CATALOG.prepare(
      `INSERT INTO workshop_items SELECT workshop_items.id||'-'||j.value,bucket_id,asset_id,run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,provenance_json,review,created_at FROM workshop_items,json_each(?) j WHERE workshop_items.id=?`,
    )
      .bind(JSON.stringify(Array.from({ length: 505 }, (_, i) => i)), original.id)
      .run();
    const browse = async (params = '') => {
      const response = await web(`/api/workshop/buckets/${s.bucket}/browse?${params}`);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json<import('../src/models/bucketBrowseInferencemodel').BucketBrowsePage>();
    };
    let page = await browse('limit=120');
    expect(page.total).toBe(506);
    expect(page.facets.runs.map(run => run.id)).toEqual([s.request.id]);
    const ids = page.items.map(item => item.id);
    // A concurrent insert is outside this traversal's snapshot.
    await env.CATALOG.prepare(
      `INSERT INTO workshop_items SELECT id||'-new',bucket_id,asset_id,run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,provenance_json,review,? FROM workshop_items WHERE id=?`,
    )
      .bind(new Date(Date.now() + 1000).toISOString(), original.id)
      .run();
    while (page.cursor) {
      page = await browse('limit=120&cursor=' + encodeURIComponent(page.cursor));
      ids.push(...page.items.map(item => item.id));
    }
    expect(ids).toHaveLength(506);
    expect(new Set(ids).size).toBe(506);
    const label = JSON.parse(original.annotation_json)[0];
    expect(
      (
        await web(
          `/api/workshop/items/${original.id}/review`,
          {
            review: 'pending',
            annotations: [
              { ...label, class_name: 'Bird', confidence: 0.3 },
              { ...label, confidence: 0.9 },
            ],
          },
          'PUT',
        )
      ).status,
    ).toBe(200);
    expect((await browse('class=Bird&min_confidence=.8')).total).toBe(0);
    expect(
      (await browse('class=Bird&max_confidence=.4&min_objects=2&max_objects=2&review=pending')).items.map(i => i.id),
    ).toEqual([original.id]);
    expect((await browse('run=missing')).total).toBe(0);
    expect(
      (await browse('from=' + encodeURIComponent(new Date(Date.parse(original.captured_at) + 1).toISOString()))).total,
    ).toBe(0);
    expect((await browse('to=' + encodeURIComponent(original.captured_at))).total).toBe(0);
    expect((await browse('saved=true')).total).toBe(0);
    for (const params of [
      'min_confidence=.9&max_confidence=.1',
      'min_objects=-1',
      'limit=0',
      'cursor=bad',
      'from=wrong',
      'review=wrong',
    ])
      expect((await web(`/api/workshop/buckets/${s.bucket}/browse?${params}`)).status).toBe(400);
    // A frame full of stars has more labels than the filter's top value, 100, which means 100 or more.
    await env.CATALOG.prepare('UPDATE workshop_items SET annotation_json=? WHERE id=?')
      .bind(JSON.stringify(Array(120).fill(label)), original.id)
      .run();
    expect((await browse('min_objects=100')).items.map(i => i.id)).toEqual([original.id]);
    const detail = await (await web(`/api/workshop/items/${original.id}`)).json<
      import('../src/models/bucketBrowseInferencemodel').BucketItemDetail
    >();
    expect(detail.recording?.start).toBe(s.start.toISOString());
    expect(detail.classes.map(c => c.name)).toEqual(['Object', 'Bird']);
    expect(detail.item.review).toBe('pending');
    expect((await web('/api/workshop/items/missing')).status).toBe(404);
    expect((await web('/api/workshop/items/missing/thumbnail')).status).toBe(404);
    await s.revoke();
  });
});

describe('bucket thumbnails', () => {
  it('lets the browser keep photos and thumbnails for a day, never past their expiry', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const item = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>()).items[0];
    const photo = await web('/api/workshop/items/' + item.id + '/image');
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Cache-Control')).toBe(`private, max-age=${browserCacheSeconds(item.expires_at)}`);
    const thumb = await web('/api/workshop/items/' + item.id + '/thumbnail?mode=object&size=512');
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('Cache-Control')).toBe(`private, max-age=${browserCacheSeconds(item.expires_at)}`);
    // The footage store crops around the box (the fake answers with what it was asked).
    expect(await thumb.text()).toBe('thumbnail?size=512&left=25&top=67&width=205&height=154');
    const frame = await web('/api/workshop/items/' + item.id + '/thumbnail?mode=frame&size=256');
    expect(await frame.text()).toBe('thumbnail?size=256');
    expect(browserCacheSeconds(new Date(Date.now() + 3 * 86400_000).toISOString())).toBe(86400);
    expect(browserCacheSeconds(new Date(Date.now() + 90_500).toISOString())).toBe(90);
    expect(browserCacheSeconds(new Date(Date.now() - 1000).toISOString())).toBe(0);
    await s.revoke();
  });
  it('makes each thumbnail once and keeps it, remaking an object crop only after its labels change', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const item = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>()).items[0];
    let made = 0;
    const making = (bytes: string) => ({
      fetch: async () => {
        made++;
        return new Response(bytes);
      },
    });
    // The footage store may be offline.
    const refusing = { fetch: async () => new Response('tunnel down', { status: 502 }) };
    // Defined, not assigned: assigning through env's prototype would replace STORE for later tests.
    const using = (store: unknown) => Object.create(env, { STORE: { value: store } }) as typeof env;
    const thumb = async (store: unknown, mode = 'object') =>
      new TextDecoder().decode(
        await new Response(
          (await bucketThumbnail(using(store), item.id, { mode, size: '512' }, null)).body,
        ).arrayBuffer(),
      );
    expect(await thumb(making('crop'))).toBe('crop');
    expect(await thumb(refusing)).toBe('crop');
    expect(made).toBe(1);
    const kept = thumbnailKey(item.id, thumbnailFile('object', 512));
    const journal = await env.CATALOG.prepare('SELECT expires_at FROM workshop_uploads WHERE object_key=?')
      .bind(kept)
      .first<{ expires_at: string }>();
    expect(journal!.expires_at).toBe(item.expires_at);
    // The website serves the kept one without the footage store, with the usual validators.
    const response = await web(`/api/workshop/items/${item.id}/thumbnail?mode=object&size=512`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('crop');
    const etag = response.headers.get('ETag')!;
    const again = await exports.default.fetch(
      new Request(`https://openskycam.test/api/workshop/items/${item.id}/thumbnail?mode=object&size=512`, {
        headers: {
          'Cf-Access-Jwt-Assertion': await accessToken({ email: 'workshop@example.test' }),
          'If-None-Match': etag,
        },
      }),
    );
    expect(again.status).toBe(304);
    // New labels move the crop, so the kept one is stale; a full frame does not depend on them.
    const label = JSON.parse(item.annotation_json)[0];
    const edit = await web(
      `/api/workshop/items/${item.id}/review`,
      { review: 'pending', annotations: [{ ...label, box: [0.5, 0.5, 0.6, 0.6] }] },
      'PUT',
    );
    expect(edit.status).toBe(200);
    await expect(thumb(refusing)).rejects.toMatchObject({ code: 'unavailable' });
    expect(await thumb(making('moved crop'))).toBe('moved crop');
    expect(await thumb(making('frame'), 'frame')).toBe('frame');
    expect(await thumb(refusing, 'frame')).toBe('frame');
    expect(await thumb(refusing)).toBe('moved crop');
    expect(made).toBe(3);
    // A photo that is gone keeps no thumbnail.
    await keepThumbnail(
      env,
      'missing',
      'thumbnails/missing/frame-512.jpg',
      etag,
      new ArrayBuffer(4),
      'f'.repeat(64),
      new Date().toISOString(),
    );
    expect(await env.WORKSHOP.head('thumbnails/missing/frame-512.jpg')).toBeNull();
    // Deleting the bucket releases its thumbnails like its saved images, and cleanup removes them.
    const preview = await (await web(`/api/workshop/buckets/${s.bucket}/deletion`)).json<WorkshopDeletionPreview>();
    expect((await web(`/api/workshop/buckets/${s.bucket}`, { revision: preview.revision }, 'DELETE')).status).toBe(200);
    const keys = [kept, thumbnailKey(item.id, thumbnailFile('frame', 512))];
    const released = await env.CATALOG.prepare('SELECT expires_at FROM workshop_uploads WHERE object_key IN (?,?)')
      .bind(...keys)
      .all<{ expires_at: string }>();
    expect(released.results).toHaveLength(2);
    for (const row of released.results) expect(Date.parse(row.expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
    await env.CATALOG.prepare('UPDATE workshop_uploads SET expires_at=? WHERE object_key IN (?,?)')
      .bind('2000-01-01T00:00:00.000Z', ...keys)
      .run();
    await cleanupWorkshop(env);
    for (const key of keys) expect(await env.WORKSHOP.head(key)).toBeNull();
    await s.revoke();
  });
  it('crops object thumbnails around the box, in the frame and its shape', () => {
    expect(thumbnailCrop(3840, 2160, [0.5, 0.5, 0.51, 0.52])).toEqual({
      left: 1877,
      top: 1066,
      width: 123,
      height: 70,
    });
    expect(thumbnailCrop(3840, 2160, [0.98, 0, 1, 0.2])).toEqual({ left: 2611, top: 0, width: 1229, height: 692 });
  });
  it('answers a failed or offline footage store with a clean error, not an exception', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const item = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>()).items[0];
    // Defined, not assigned: assigning through env's prototype would replace STORE for later tests.
    const down = { fetch: async () => new Response('tunnel down', { status: 502 }) };
    const broken = Object.create(env, { STORE: { value: down } }) as typeof env;
    await expect(bucketThumbnail(broken, item.id, { mode: 'frame', size: '256' }, null)).rejects.toMatchObject({
      name: 'ApplicationError',
      code: 'unavailable',
    });
    await s.revoke();
  });
});
describe('Workshop saved state and execution', () => {
  it("streams a leased job's recording from the footage store", async () => {
    const recording = Uint8Array.from({ length: 4_000 }, (_, i) => i % 251);
    const s = await setup({ body: recording }),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    const input = await exports.default.fetch(
      new Request(`https://api.example.com/v1/workshop/jobs/${job.id}/input`, {
        headers: {
          Authorization: 'Bearer ' + s.token,
          'X-Lease-Token': job.lease_token!,
          'X-Lease-Generation': String(job.generation),
        },
      }),
    );
    expect(input.status, await input.clone().text()).toBe(200);
    expect(input.headers.get('Content-Length')).toBe('4000');
    expect(new Uint8Array(await input.arrayBuffer())).toEqual(recording);
    await s.revoke();
  });
  it('deletes a workflow, fences its unfinished jobs, and preserves its results and run history', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    const pending = { ...s.request, id: crypto.randomUUID() };
    expect((await web('/api/workshop/runs', pending)).status).toBe(201);
    const active = (await (await s.claim()).json<{ job: WorkshopJob }>()).job;
    const path = '/api/workshop/workflows/' + s.request.workflow_id;
    const preview = await (await web(path + '/deletion')).json<WorkshopDeletionPreview>();
    expect(preview).toMatchObject({
      kind: 'workflow',
      id: s.request.workflow_id,
      active_runs: 1,
      revision: s.request.revision,
    });
    // A stale confirmation cannot cancel jobs or remove the document entry.
    expect((await web(path, { revision: preview.revision - 1 }, 'DELETE')).status).toBe(
      preview.revision === 1 ? 400 : 409,
    );
    expect((await workshopOps.job(env, active.id))!.status).toBe('leased');
    const removed = await web(path, { revision: preview.revision }, 'DELETE');
    expect(removed.status, await removed.clone().text()).toBe(200);
    const state = await removed.json<WorkshopState>();
    expect(state.document.workflows.some(w => w.id === s.request.workflow_id)).toBe(false);
    expect(state.document.buckets.some(b => b.id === s.bucket)).toBe(true);
    expect((await web(`/api/workshop/items/${original.id}/image`)).status).toBe(200);
    expect((await web('/api/workshop/runs/' + s.request.id)).status).toBe(200);
    expect((await workshopOps.job(env, active.id))!.status).toBe('cancelled');
    expect(
      (
        await api(
          s.token,
          `/jobs/${active.id}/heartbeat`,
          {},
          { 'X-Lease-Token': active.lease_token!, 'X-Lease-Generation': String(active.generation) },
        )
      ).status,
    ).toBe(409);
    expect((await api(s.token, `/jobs/${active.id}/complete`, { ...lease(active) })).status).toBe(409);
    // A run prepared before the delete cannot enqueue work after the revision advances.
    const previous = (await workshopOps.run(env, s.request.id))!;
    const stale: WorkshopRun = { ...previous, id: crypto.randomUUID() };
    await workshopOps.insertRun(
      env,
      stale,
      [
        {
          id: stale.id + '_0',
          cam: 'sky01',
          input_json: job.input_json,
          expires_at: job.expires_at,
          expected_images: 1,
        },
      ],
      preview.revision,
    );
    expect(await workshopOps.run(env, stale.id)).toBeNull();
    expect(await workshopOps.job(env, stale.id + '_0')).toBeNull();
  });
  it('deletes populated buckets and versions, clears linked steps, and keeps shared saved bytes', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const contents = () => web('/api/workshop/buckets/' + s.bucket);
    let original = (await (await contents()).json<{ items: WorkshopItem[] }>()).items[0];
    expect((await web(`/api/workshop/items/${original.id}/save`, {})).status).toBe(200);
    expect((await web(`/api/workshop/items/${original.id}/review`, { review: 'accepted' }, 'PUT')).status).toBe(200);
    original = (await (await contents()).json<{ items: WorkshopItem[] }>()).items[0];
    const version = crypto.randomUUID();
    expect(
      (await web(`/api/workshop/buckets/${s.bucket}/versions`, { id: version, name: 'Saved version' })).status,
    ).toBe(201);
    const state = await (await web('/api/workshop')).json<WorkshopState>();
    const other = 'shared-' + crypto.randomUUID(),
      copy = original.id + '-shared';
    state.document.buckets.push({
      id: other,
      name: other,
      kind: 'labeled',
      description: '',
      createdAt: new Date().toISOString(),
    });
    const reader = structuredClone(state.document.workflows.find(w => w.id === s.request.workflow_id)!);
    reader.id = 'reader-' + crypto.randomUUID();
    reader.nodes[0].data.bucketId = s.bucket;
    reader.nodes[3].data.bucketId = other;
    state.document.workflows.push(reader);
    expect((await web('/api/workshop', state, 'PUT')).status).toBe(200);
    await env.CATALOG.prepare(
      `INSERT INTO workshop_items SELECT ?,?,asset_id,run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,provenance_json,review,created_at FROM workshop_items WHERE id=?`,
    )
      .bind(copy, other, original.id)
      .run();
    const request = { ...s.request, id: crypto.randomUUID(), revision: state.revision + 1 };
    expect((await web('/api/workshop/runs', request)).status).toBe(201);
    const preview = await (await web(`/api/workshop/buckets/${s.bucket}/deletion`)).json<WorkshopDeletionPreview>();
    expect(preview).toMatchObject({ images: 1, saved_images: 1, versions: 1, active_runs: 1 });
    expect(preview.linked_workflows.map(w => w.id).sort()).toEqual([reader.id, s.request.workflow_id].sort());
    // The whole transaction has a revision fence, including every destructive statement.
    expect(
      await deleteEntry(
        env,
        'bucket',
        s.bucket,
        preview.revision - 1,
        '{}',
        new Date().toISOString(),
        new Date().toISOString(),
      ),
    ).toBe(false);
    expect((await contents()).status).toBe(200);
    expect((await web('/api/workshop/versions/' + version)).status).toBe(200);
    expect((await workshopOps.job(env, request.id + '_0'))!.status).toBe('queued');
    const response = await web('/api/workshop/buckets/' + s.bucket, { revision: preview.revision }, 'DELETE');
    expect(response.status, await response.clone().text()).toBe(200);
    const deleted = await response.json<WorkshopState>();
    const writer = deleted.document.workflows.find(w => w.id === s.request.workflow_id)!;
    expect(writer.nodes[3].data.bucketId).toBe('');
    expect(deleted.document.workflows.find(w => w.id === reader.id)!.nodes[0].data.bucketId).toBe('');
    expect(writer.edges).toEqual(state.document.workflows.find(w => w.id === s.request.workflow_id)!.edges);
    expect((await contents()).status).toBe(404);
    expect((await web('/api/workshop/versions/' + version)).status).toBe(404);
    expect(
      await env.CATALOG.prepare('SELECT COUNT(*) n FROM workshop_version_items WHERE version_id=?').bind(version).first('n'),
    ).toBe(0);
    expect((await web(`/api/workshop/items/${original.id}/image`)).status).toBe(404);
    expect((await web(`/api/workshop/items/${copy}/image`)).status).toBe(200);
    expect((await workshopOps.job(env, request.id + '_0'))!.status).toBe('cancelled');
    expect(
      (await web('/api/workshop/runs', { ...request, id: crypto.randomUUID(), revision: deleted.revision })).status,
    ).toBe(400);
    // A late completion retry cannot reinsert an item after its bucket disappeared.
    const finished = (await workshopOps.job(env, job.id))!;
    const digest = (await env.CATALOG.prepare('SELECT result_sha256 FROM workshop_jobs WHERE id=?')
      .bind(job.id)
      .first<{ result_sha256: string }>())!.result_sha256;
    await workshopOps.complete(env, finished, digest, [original], new Date().toISOString());
    expect(await workshopOps.item(env, original.id, new Date().toISOString())).toBeNull();
    const journal = await env.CATALOG.prepare('SELECT expires_at FROM workshop_uploads WHERE object_key=?')
      .bind(original.object_key)
      .first<{ expires_at: string }>();
    expect(journal!.expires_at).toBe('9999-12-31T23:59:59.999Z');
    await cleanupWorkshop(env);
    expect(await env.WORKSHOP.head(original.object_key)).not.toBeNull();
    // Incomplete drafts still save; choosing a new destination is required only to execute.
    expect((await web('/api/workshop', deleted, 'PUT')).status).toBe(200);
    const otherPreview = await (await web(`/api/workshop/buckets/${other}/deletion`)).json<WorkshopDeletionPreview>();
    expect((await web(`/api/workshop/buckets/${other}`, { revision: otherPreview.revision }, 'DELETE')).status).toBe(
      200,
    );
    const orphan = await env.CATALOG.prepare('SELECT expires_at FROM workshop_uploads WHERE object_key=?')
      .bind(original.object_key)
      .first<{ expires_at: string }>();
    expect(Date.parse(orphan!.expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
    expect(Date.parse(orphan!.expires_at)).toBeGreaterThan(Date.now());
    // Cleanup defers a saved image still used by a temporary preview, then collects it
    // after that last reference expires (rather than retaining orphaned bytes forever).
    const expired = '2000-01-01T00:00:00.000Z';
    await env.CATALOG.prepare('UPDATE workshop_uploads SET expires_at=? WHERE object_key=?')
      .bind(expired, original.object_key)
      .run();
    await env.CATALOG.prepare('INSERT INTO workshop_previews VALUES(?,?,?,?,?,?)')
      .bind(
        job.id,
        job.generation,
        0,
        'shared-preview',
        JSON.stringify({ ...original, id: 'shared-preview', bucket_id: 'another-output' }),
        new Date(Date.now() + 60000).toISOString(),
      )
      .run();
    await cleanupWorkshop(env);
    expect(await env.WORKSHOP.head(original.object_key)).not.toBeNull();
    await env.CATALOG.prepare('UPDATE workshop_previews SET expires_at=? WHERE item_id=?')
      .bind(expired, 'shared-preview')
      .run();
    await cleanupWorkshop(env);
    expect(await env.WORKSHOP.head(original.object_key)).toBeNull();
  });
  it('protects the camera archive and requires explicit same-origin deletion', async () => {
    const s = await setup();
    const path = '/api/workshop/workflows/' + s.request.workflow_id;
    const response = await exports.default.fetch(
      new Request('https://openskycam.test' + path, {
        method: 'DELETE',
        headers: {
          'Cf-Access-Jwt-Assertion': await accessToken({ email: 'workshop@example.test' }),
          Origin: 'https://elsewhere.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ revision: s.request.revision }),
      }),
    );
    expect(response.status).toBe(403);
    expect((await web('/api/workshop/buckets/camera-archive', { revision: s.request.revision }, 'DELETE')).status).toBe(
      400,
    );
    const state = await (await web('/api/workshop')).json<WorkshopState>();
    state.document.workflows = state.document.workflows.filter(w => w.id !== s.request.workflow_id);
    expect((await web('/api/workshop', state, 'PUT')).status).toBe(400);
    expect((await workshopOps.job(env, s.request.id + '_0'))!.status).toBe('queued');
  });
  it('caps a test, publishes live previews, and never creates bucket members or a dataset', async () => {
    const s = await setup({ mode: 'test', image_limit: 3, interval: 5 });
    const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    expect(JSON.parse(job.input_json).sample_limit).toBe(3);
    expect(job.expected_images).toBe(3);
    expect(Date.parse(job.expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
    const body = await commit(s, job, 3, false);
    const progress = (sequence: number) =>
      api(s.token, `/jobs/${job.id}/progress`, {
        ...lease(job),
        phase: 'processing',
        node_id: 'n2',
        processed: sequence + 1,
        sequence,
        frame: body.frames[sequence],
      });
    expect((await progress(2)).status).toBe(400);
    expect((await progress(0)).status).toBe(200);
    expect((await progress(0)).status).toBe(200);
    const detail = await (await web('/api/workshop/runs/' + s.request.id)).json<{
      mode: string;
      processed_images: number;
      expected_images: number;
      status: string;
      images: { id: string; image_url: string }[];
      output_buckets: string[];
    }>();
    expect(detail).toMatchObject({
      mode: 'test',
      processed_images: 1,
      expected_images: 3,
      status: 'running',
      output_buckets: [],
    });
    expect(detail.images).toHaveLength(1);
    const image = detail.images[0];
    expect((await web(image.image_url)).status).toBe(200);
    expect((await web(`/api/workshop/items/${image.id}/save`, {})).status).toBe(404);
    expect((await progress(1)).status).toBe(200);
    expect((await progress(2)).status).toBe(200);
    expect(
      (await api(s.token, `/jobs/${job.id}/complete`, { ...body, sampled_frames: 2, frames: body.frames.slice(0, 2) }))
        .status,
    ).toBe(400);
    expect((await api(s.token, `/jobs/${job.id}/complete`, body)).status).toBe(200);
    expect((await (await web('/api/workshop/runs/' + s.request.id)).json<{ images: unknown[] }>()).images).toHaveLength(
      3,
    );
    expect((await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: unknown[] }>()).items).toHaveLength(0);
    expect(
      (await web(`/api/workshop/buckets/${s.bucket}/versions`, { id: crypto.randomUUID(), name: 'Test export' }))
        .status,
    ).toBe(400);
    const expired = '2000-01-01T00:00:00.000Z';
    await env.CATALOG.prepare('UPDATE workshop_previews SET expires_at=? WHERE job_id=?').bind(expired, job.id).run();
    await env.CATALOG.prepare('UPDATE workshop_uploads SET expires_at=? WHERE job_id=?').bind(expired, job.id).run();
    expect((await web(image.image_url)).status).toBe(404);
    await cleanupWorkshop(env);
    expect(
      (await env.CATALOG.prepare('SELECT COUNT(*) AS n FROM workshop_previews WHERE job_id=?')
        .bind(job.id)
        .first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it('accepts slots a camera gap left empty only when the result names them and every frame keeps its own slot', async () => {
    const s = await setup({ mode: 'test', image_limit: 3, interval: 5 });
    const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    const body = await commit(s, job, 3, false);
    const [first, , last] = body.frames;
    const progress = (extra: object) =>
      api(s.token, `/jobs/${job.id}/progress`, { ...lease(job), phase: 'processing', node_id: 'n2', ...extra });
    expect((await progress({ processed: 1, sequence: 0, frame: first })).status).toBe(200);
    expect((await progress({ node_id: null, processed: 2 })).status).toBe(400);
    expect((await progress({ node_id: null, processed: 2, empty: true })).status).toBe(200);
    expect((await progress({ processed: 3, sequence: 2, frame: last })).status).toBe(200);
    const complete = (extra: object) =>
      api(s.token, `/jobs/${job.id}/complete`, { ...body, sampled_frames: 2, frames: [first, last], ...extra });
    expect((await complete({})).status).toBe(400);
    expect((await complete({ empty_slots: [2] })).status).toBe(400);
    expect((await complete({ empty_slots: [1], frames: [first, { ...last, offset: 5 }] })).status).toBe(400);
    expect((await complete({ empty_slots: [1] })).status).toBe(200);
    await s.revoke();
  });
  it('schedules only whole sample slots, so a clip ending just past a second keeps a frame in every slot', async () => {
    // Night clips run 8 fps: a 57.032 s clip's last frame starts near 56.9 s, so a slot at 57 s has no frame.
    const s = await setup({ mode: 'run', interval: 1, durationS: 57.032 });
    const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    const input = JSON.parse(job.input_json);
    expect(job.expected_images).toBe(57);
    expect(input.sample_limit).toBe(57);
    expect(input.from + input.sample_limit * 1).toBeLessThanOrEqual(input.until);
    await s.revoke();
  });
  it('test expiry never deletes a reused canonical image or its existing labels', async () => {
    const s = await setup();
    const originalJob = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, originalJob.job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    const state = await (await web('/api/workshop')).json<{ revision: number; document: WorkshopDocument }>();
    const workflow = state.document.workflows.find(w => w.id === s.request.workflow_id)!;
    const output = 'test-output-' + crypto.randomUUID();
    state.document.buckets.push({
      id: output,
      kind: 'labeled',
      name: 'Test destination',
      description: '',
      createdAt: new Date().toISOString(),
    });
    workflow.nodes[0].data.bucketId = s.bucket;
    workflow.nodes[3].data.bucketId = output;
    workflow.nodes = workflow.nodes.filter(n => n.id !== 'n1');
    workflow.edges = [
      { id: 'image-model', source: 'n0', target: 'n2', sourceHandle: 'out', targetHandle: 'in' },
      { id: 'model-output', source: 'n2', target: 'n3', sourceHandle: 'out', targetHandle: 'in' },
    ];
    expect((await web('/api/workshop', state, 'PUT')).status).toBe(200);
    const request = {
      ...s.request,
      id: crypto.randomUUID(),
      revision: state.revision + 1,
      mode: 'test',
      image_limit: 1,
    };
    expect((await web('/api/workshop/runs', request)).status).toBe(201);
    const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    const body = await commit({ ...s, bucket: output }, job, 1, false);
    expect((await api(s.token, `/jobs/${job.id}/complete`, body)).status).toBe(200);
    await env.CATALOG.prepare('UPDATE workshop_previews SET expires_at=? WHERE job_id=?')
      .bind('2000-01-01', job.id)
      .run();
    await env.CATALOG.prepare('UPDATE workshop_uploads SET expires_at=? WHERE job_id=?')
      .bind('2000-01-01', job.id)
      .run();
    await cleanupWorkshop(env);
    expect(await env.WORKSHOP.head(original.object_key)).not.toBeNull();
    expect((await web('/api/workshop/items/' + original.id + '/image')).status).toBe(200);
    expect((await (await web('/api/workshop/buckets/' + output)).json<{ items: unknown[] }>()).items).toHaveLength(0);
  });
  it('hides stale attempt previews and rejects progress after cancellation', async () => {
    const s = await setup({ mode: 'test', image_limit: 1 });
    const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    const body = await commit(s, job, 1, false);
    const event = {
      ...lease(job),
      phase: 'processing',
      node_id: 'n2',
      processed: 1,
      sequence: 0,
      frame: body.frames[0],
    };
    expect((await api(s.token, `/jobs/${job.id}/progress`, event)).status).toBe(200);
    await env.CATALOG.prepare('UPDATE workshop_jobs SET lease_until=? WHERE id=?').bind('2000-01-01', job.id).run();
    const fresh = await (await s.claim()).json<{ job: WorkshopJob }>();
    expect((await api(s.token, `/jobs/${job.id}/progress`, event)).status).toBe(409);
    expect((await (await web('/api/workshop/runs/' + s.request.id)).json<{ images: unknown[] }>()).images).toHaveLength(
      0,
    );
    await web('/api/workshop/runs/' + s.request.id + '/cancel', {});
    expect((await api(s.token, `/jobs/${job.id}/progress`, { ...event, ...lease(fresh.job) })).status).toBe(409);
  });
  it('counts eligible inputs beyond rejected proposals before applying a run limit', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    await env.CATALOG.prepare(
      `INSERT INTO workshop_items SELECT workshop_items.id||'-'||j.value,bucket_id,asset_id,run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,provenance_json,'rejected','9999-01-01' FROM workshop_items,json_each(?) j WHERE workshop_items.id=?`,
    )
      .bind(JSON.stringify(Array.from({ length: 101 }, (_, i) => i)), original.id)
      .run();
    const available = await inputItems(env, s.bucket, new Date().toISOString(), 101);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(original.id);
  });

  it('re-processes up to 2,000 labeled images per run, with rejected ones only when asked', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    const copy = (count: number, review: string, tag: string) =>
      env.CATALOG.prepare(
        `INSERT INTO workshop_items SELECT workshop_items.id||'-${tag}'||j.value,bucket_id,asset_id,run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,provenance_json,?,created_at FROM workshop_items,json_each(?) j WHERE workshop_items.id=?`,
      )
        .bind(review, JSON.stringify(Array.from({ length: count }, (_, i) => i)), original.id)
        .run();
    await copy(149, 'accepted', 'a');
    await copy(20, 'rejected', 'r');
    const plan = async (includeRejected?: boolean) => {
      const state = await (await web('/api/workshop')).json<{ revision: number; document: WorkshopDocument }>();
      const flow = state.document.workflows.find(w =>
        w.nodes.some(n => n.data.kind === 'output' && n.data.bucketId === s.bucket),
      )!;
      const out = 'out-' + crypto.randomUUID(),
        wf = 'rerun-' + crypto.randomUUID();
      state.document.buckets.push({
        id: out,
        kind: 'labeled',
        name: out,
        description: '',
        createdAt: new Date().toISOString(),
      });
      const data = [
        {
          kind: 'input',
          label: 'Input',
          bucketId: s.bucket,
          camera: '',
          ...(includeRejected === undefined ? {} : { includeRejected }),
        },
        flow.nodes.find(n => n.data.kind === 'model')!.data,
        { kind: 'output', label: 'Output', bucketId: out },
      ];
      state.document.workflows.push({
        id: wf,
        name: wf,
        updatedAt: new Date().toISOString(),
        nodes: data.map((d, i) => ({
          id: 'n' + i,
          type: 'workshop',
          position: { x: 0, y: 0 },
          data: d,
        })) as typeof flow.nodes,
        edges: [0, 1].map(i => ({
          id: 'e' + i,
          source: 'n' + i,
          target: 'n' + (i + 1),
          sourceHandle: 'out',
          targetHandle: 'in',
        })),
      });
      expect((await web('/api/workshop', state, 'PUT')).status).toBe(200);
      const response = await web('/api/workshop/runs', {
        id: crypto.randomUUID(),
        workflow_id: wf,
        runtime_id: s.runtime.id,
        revision: state.revision + 1,
      });
      if (response.status !== 201) return response.status;
      const run = await response.json<{ id: string }>();
      return (await env.CATALOG.prepare('SELECT COUNT(*) n FROM workshop_jobs WHERE run_id=?')
        .bind(run.id)
        .first<{ n: number }>())!.n;
    };
    expect(await plan()).toBe(150);
    expect(await plan(false)).toBe(150);
    expect(await plan(true)).toBe(170);
    // 1,981 usable images: ten insert chunks, all planned. With the 20 rejected ones it is over the limit.
    await copy(1831, 'pending', 'p');
    expect(await plan()).toBe(1981);
    expect(await plan(true)).toBe(400);
    await s.revoke();
  });

  it('requires same-origin writes and compares revisions without overwriting another window', async () => {
    const state = await (await web('/api/workshop')).json<{ revision: number; document: WorkshopDocument }>();
    expect((await web('/api/workshop', state, 'PUT')).status).toBe(200);
    expect((await web('/api/workshop', state, 'PUT')).status).toBe(409);
    const r = await exports.default.fetch(
      new Request('https://openskycam.test/api/workshop', {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': await accessToken({
            email: 'workshop@example.test',
          }),
          Origin: 'https://elsewhere.test',
        },
        body: JSON.stringify(state),
      }),
    );
    expect(r.status).toBe(403);
  });
  it('runs a model at its training size, whether the card records a number or a pair', async () => {
    // The training hook publishes training_size as a number; imported manifests use [width, height].
    for (const [input, imgsz] of [
      [{ training_size: 1280 }, 1280],
      [{ training_size: [960, 960] }, 960],
      [{}, 640],
    ] as const) {
      const s = await setup({ input });
      const row = await env.CATALOG.prepare('SELECT snapshot_json FROM workshop_runs WHERE id=?')
        .bind(s.request.id)
        .first<{ snapshot_json: string }>();
      expect(JSON.parse(row!.snapshot_json).models[0].imgsz, JSON.stringify(input)).toBe(imgsz);
      await s.revoke();
    }
  });
  it('pins inputs and graph, submits idempotently, and fences stale leases', async () => {
    const s = await setup();
    expect((await web('/api/workshop/runs', s.request)).status).toBe(201);
    const [a, b] = await Promise.all([s.claim(), s.claim()]);
    const values = await Promise.all([a.json<{ job: WorkshopJob | null }>(), b.json<{ job: WorkshopJob | null }>()]);
    expect(values.filter(v => v.job)).toHaveLength(1);
    const job = values.find(v => v.job)!.job!;
    const row = await env.CATALOG.prepare('SELECT snapshot_json FROM workshop_runs WHERE id=?')
      .bind(s.request.id)
      .first<{ snapshot_json: string }>();
    expect(JSON.parse(row!.snapshot_json).models[0].artifact_sha256).toBe(modelHash);
    await env.CATALOG.prepare('UPDATE workshop_jobs SET lease_until=? WHERE id=?')
      .bind('2000-01-01T00:00:00Z', job.id)
      .run();
    const fresh = await (await s.claim()).json<{ job: WorkshopJob }>();
    expect(fresh.job.generation).toBe(job.generation + 1);
    expect(
      (
        await api(s.token, `/jobs/${job.id}/complete`, {
          ...lease(job),
          frames: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(s.token, '/claim', {
          runtime_id: s.runtime.id,
          code_sha256: 'a'.repeat(64),
        })
      ).status,
    ).toBe(403);
  });
  it('commits once, reviews results, freezes a dataset, and enforces inherited expiry', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>(),
      body = await commit(s, job);
    expect((await api(s.token, `/jobs/${job.id}/complete`, body)).status).toBe(200);
    expect(
      (
        await api(s.token, `/jobs/${job.id}/complete`, {
          ...body,
          frames: body.frames.map(f => ({ ...f, annotations: [] })),
        })
      ).status,
    ).toBe(409);
    const contents = await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>();
    expect(contents.items).toHaveLength(1);
    const item = contents.items[0];
    expect(item.expires_at).toBe(new Date(+s.start + 40 * 86400000).toISOString());
    expect((await web(`/api/workshop/items/${item.id}/review`, { review: 'accepted' }, 'PUT')).status).toBe(200);
    const vbody = { id: crypto.randomUUID(), name: 'Reviewed v1' },
      response = await web(`/api/workshop/buckets/${s.bucket}/versions`, vbody);
    expect(response.status, await response.clone().text()).toBe(201);
    const version = await response.json<WorkshopVersionSummary>();
    expect(version).toMatchObject({ id: vbody.id, images: 1 });
    const exportVersion = async () =>
      (await (await web('/api/workshop/versions/' + version.id)).json<{ manifest: WorkshopVersionManifest }>())
        .manifest;
    const snapshot = await exportVersion();
    expect(snapshot.items[0].annotations[0].class_name).toBe('Object');
    expect(snapshot.items[0].expires_at).toBe(item.expires_at);
    expect(snapshot.class_names).toEqual(['Bird', 'Object']);
    expect(snapshot.items[0].annotations[0]).toMatchObject({
      class_id: 1,
      model_class_id: 0,
    });
    await web(`/api/workshop/items/${item.id}/review`, { review: 'rejected' }, 'PUT');
    expect(await exportVersion()).toEqual(snapshot);
    await env.CATALOG.prepare('UPDATE workshop_items SET expires_at=? WHERE id=?')
      .bind('2000-01-01T00:00:00.000Z', item.id)
      .run();
    expect((await web('/api/workshop/items/' + item.id + '/image')).status).toBe(404);
    await env.CATALOG.prepare('UPDATE workshop_uploads SET expires_at=? WHERE object_key=?')
      .bind('2000-01-01T00:00:00.000Z', item.object_key)
      .run();
    await env.CATALOG.prepare("UPDATE workshop_jobs SET expires_at=?,status='expired' WHERE id=?")
      .bind('2000-01-01T00:00:00.000Z', job.id)
      .run();
    // A version records its members' expiry when frozen; one whose recorded expiry has passed is purged with its items.
    const expired = crypto.randomUUID();
    await env.CATALOG.batch([
      env.CATALOG.prepare('INSERT INTO workshop_versions VALUES(?,?,?,?,?,?)').bind(
        expired,
        s.bucket,
        'Expired',
        '{}',
        'e'.repeat(64),
        new Date().toISOString(),
      ),
      env.CATALOG.prepare("INSERT INTO workshop_version_items VALUES(?,0,'2000-01-01T00:00:00.000Z','{}')").bind(expired),
    ]);
    await cleanupWorkshop(env);
    const rows = (id: string) =>
      env.CATALOG.prepare(
        'SELECT (SELECT COUNT(*) FROM workshop_versions WHERE id=?1) + (SELECT COUNT(*) FROM workshop_version_items WHERE version_id=?1) n',
      )
        .bind(id)
        .first('n');
    expect(await rows(expired)).toBe(0);
    expect(await rows(version.id)).toBe(2);
    expect(
      (await env.CATALOG.prepare('SELECT input_json FROM workshop_jobs WHERE id=?')
        .bind(job.id)
        .first<{ input_json: string }>())!.input_json,
    ).toBe('{}');
    expect(await env.WORKSHOP.head(item.object_key)).toBeNull();
  });
  it('freezes more accepted images than one D1 row can hold, and exports exactly what it hashed', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    // 1,300 distinct accepted images with production-sized provenance: about 3 MB of manifest.
    await env.CATALOG.prepare(
      `INSERT INTO workshop_items SELECT workshop_items.id||'-'||j.value,bucket_id,asset_id||'-'||j.value,run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,json_set(provenance_json,'$.pad',hex(randomblob(800))),'accepted',created_at FROM workshop_items,json_each(?) j WHERE workshop_items.id=?`,
    )
      .bind(JSON.stringify(Array.from({ length: 1300 }, (_, i) => i)), original.id)
      .run();
    const vbody = { id: crypto.randomUUID(), name: 'Large' },
      response = await web(`/api/workshop/buckets/${s.bucket}/versions`, vbody);
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toMatchObject({ id: vbody.id, images: 1300 });
    const exported = await (await web('/api/workshop/versions/' + vbody.id)).json<{
      sha256: string;
      manifest: WorkshopVersionManifest;
    }>();
    expect(new Set(exported.manifest.items.map(i => i.item_id)).size).toBe(1300);
    expect(await sha256(canonicalModel(exported.manifest))).toBe(exported.sha256);
    // D1 refuses a string or row over 2 MB, so no row may hold the whole manifest.
    const rows = await env.CATALOG.prepare(
      'SELECT (SELECT length(manifest_json) FROM workshop_versions WHERE id=?1) header, MAX(length(item_json)) item, SUM(length(item_json)) total FROM workshop_version_items WHERE version_id=?1',
    )
      .bind(vbody.id)
      .first<{ header: number; item: number; total: number }>();
    expect(rows!.total).toBeGreaterThan(2_000_000);
    expect(Math.max(rows!.header, rows!.item)).toBeLessThan(10_000);
    const listed = await (await web('/api/workshop/buckets/' + s.bucket)).json<{
      versions: WorkshopVersionSummary[];
    }>();
    expect(listed.versions).toEqual([expect.objectContaining({ id: vbody.id, images: 1300 })]);
    expect(listed.versions[0]).not.toHaveProperty('manifest_json');
    await s.revoke();
  });
  it('freezes images reviewed No only when asked, preferring a Yes for the same image', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const original = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    // The original is a No; '-yes' is a Yes for the same image; '-no' and '-pending' are other images.
    await env.CATALOG.batch([
      env.CATALOG.prepare("UPDATE workshop_items SET review='rejected' WHERE id=?").bind(original.id),
      env.CATALOG.prepare(
        `INSERT INTO workshop_items SELECT workshop_items.id||'-'||json_extract(j.value,'$[0]'),bucket_id,asset_id||json_extract(j.value,'$[1]'),run_id,job_id,source_sha256,cam,captured_at,object_key,sha256,expires_at,annotation_json,provenance_json,json_extract(j.value,'$[2]'),created_at FROM workshop_items,json_each(?) j WHERE workshop_items.id=?`,
      ).bind(
        JSON.stringify([
          ['yes', '', 'accepted'],
          ['no', '-no', 'rejected'],
          ['pending', '-pending', 'pending'],
        ]),
        original.id,
      ),
    ]);
    const freeze = async (body: object) => {
      const id = crypto.randomUUID(),
        response = await web(`/api/workshop/buckets/${s.bucket}/versions`, { id, name: 'Reviewed', ...body });
      expect(response.status, await response.clone().text()).toBe(201);
      const { manifest } = await (await web('/api/workshop/versions/' + id)).json<{
        manifest: WorkshopVersionManifest;
      }>();
      return manifest.items.map(i => [i.item_id, i.review, i.annotations.length]);
    };
    expect(await freeze({})).toEqual([[original.id + '-yes', 'accepted', 1]]);
    expect(await freeze({ include_rejected: true })).toEqual([
      [original.id + '-yes', 'accepted', 1],
      [original.id + '-no', 'rejected', 1],
    ]);
    expect(
      (await web(`/api/workshop/buckets/${s.bucket}/versions`, { id: crypto.randomUUID(), name: 'x', include_rejected: 1 }))
        .status,
    ).toBe(400);
    // A review that changed after selection fails the version instead of freezing a stale decision.
    const stale = { ...(JSON.parse('{}') as WorkshopVersionManifest['items'][number]), item_id: original.id + '-no' };
    expect(
      await workshopOps.insertVersion(
        env,
        {
          id: crypto.randomUUID(),
          bucket_id: s.bucket,
          name: 'Stale',
          manifest_json: '{}',
          sha256: 'f'.repeat(64),
          created_at: new Date().toISOString(),
        },
        [{ ...stale, review: 'accepted', expires_at: original.expires_at }],
        new Date().toISOString(),
      ),
    ).toBe(false);
    await s.revoke();
  });
  it('retains selected images and exposes immutable exports only to camera-scoped read keys', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job);
    const contents = await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>(),
      original = contents.items[0];
    expect((await web(`/api/workshop/items/${original.id}/save`, {})).status).toBe(200);
    expect((await web(`/api/workshop/items/${original.id}/save`, {})).status).toBe(200);
    const retained = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>())
      .items[0];
    expect(retained.object_key.startsWith('retained/')).toBe(true);
    expect(retained.expires_at).toBe('9999-12-31T23:59:59.999Z');
    expect(JSON.parse(retained.provenance_json).source_expires_at).toBe(original.expires_at);
    await web(`/api/workshop/items/${original.id}/review`, { review: 'accepted' }, 'PUT');
    const vbody = { id: crypto.randomUUID(), name: 'Saved version' };
    expect((await web(`/api/workshop/buckets/${s.bucket}/versions`, vbody)).status).toBe(201);
    const ordinary = await (
      await web('/api/keys', {
        name: 'Dataset ' + crypto.randomUUID(),
        cameras: ['sky01'],
        expires_in_days: 1,
      })
    ).json<{ token: string }>();
    const read = (token: string, path: string) =>
      exports.default.fetch(
        new Request('https://api.example.com/v1/workshop' + path, {
          headers: { Authorization: 'Bearer ' + token },
        }),
      );
    expect((await read(s.token, '/versions/' + vbody.id)).status).toBe(403);
    const exported = await read(ordinary.token, '/versions/' + vbody.id);
    expect(exported.status).toBe(200);
    const version = await exported.json<{
      manifest: { items: { media_path: string; expires_at: string }[] };
    }>();
    expect(version.manifest.items[0].expires_at).toBe(retained.expires_at);
    await env.CATALOG.prepare('UPDATE workshop_uploads SET expires_at=? WHERE object_key=?')
      .bind('2000-01-01T00:00:00.000Z', original.object_key)
      .run();
    await cleanupWorkshop(env);
    expect(await env.WORKSHOP.head(original.object_key)).toBeNull();
    expect(await env.WORKSHOP.head(retained.object_key)).not.toBeNull();
    const image = await read(ordinary.token, version.manifest.items[0].media_path.replace('/v1/workshop', ''));
    expect(image.status).toBe(200);
    expect(await sha256(await image.arrayBuffer())).toBe(retained.sha256);
  });
  it('rejects labeled-input branches that bypass a labeling model', async () => {
    const s = await setup(),
      workflow = s.state.document.workflows.find(w => w.id === s.request.workflow_id)!;
    const input = workflow.nodes[0],
      output = workflow.nodes[3];
    input.data.bucketId = 'another-labeled-bucket';
    expect(() =>
      executionGraph({
        ...workflow,
        nodes: [input, output],
        edges: [
          {
            id: 'direct',
            source: input.id,
            target: output.id,
            sourceHandle: 'out',
            targetHandle: 'in',
          },
        ],
      }),
    ).toThrow('Every output path needs a model');
  });
  it('accepts an otherwise branch that ends at do nothing', () => {
    const node = (id: string, data: Record<string, unknown>) => ({
      id,
      type: 'workshop' as const,
      position: { x: 0, y: 0 },
      data,
    });
    const edge = (id: string, source: string, target: string, sourceHandle = 'out') => ({
      id,
      source,
      target,
      sourceHandle,
      targetHandle: 'in',
    });
    expect(
      executionGraph({
        id: 'wildlife',
        name: 'Wildlife',
        updatedAt: '2026-09-24T00:00:00.000Z',
        nodes: [
          node('in', { kind: 'input', label: 'Input', bucketId: 'camera-archive', camera: 'sky01' }),
          node('foot', {
            kind: 'footage',
            label: 'Footage',
            day: '2026-09-24',
            from: '10:00',
            until: '18:00',
            interval: 5,
          }),
          node('model', { kind: 'model', label: 'Model', modelKey: 'detector/v1', score: 0.5 }),
          node('gate', {
            kind: 'condition',
            label: 'Class present',
            match: 'all',
            rules: [{ id: 'rule', kind: 'class', className: 'WildLife', operator: 'present' }],
          }),
          node('out', { kind: 'output', label: 'Output', bucketId: 'kept' }),
          node('skip', { kind: 'nothing', label: 'Do nothing' }),
        ],
        edges: [
          edge('a', 'in', 'foot'),
          edge('b', 'foot', 'model'),
          edge('c', 'model', 'gate'),
          edge('d', 'gate', 'out', 'yes'),
          edge('e', 'gate', 'skip', 'no'),
        ],
      }).outputs,
    ).toHaveLength(1);
  });
  it('rejects ordinary footage keys and cancelled jobs', async () => {
    const s = await setup();
    const ordinary = await (
      await web('/api/keys', {
        name: 'Read ' + crypto.randomUUID(),
        cameras: ['sky01'],
        expires_in_days: 1,
      })
    ).json<{ token: string }>();
    expect(
      (
        await api(ordinary.token, '/claim', {
          runtime_id: s.runtime.id,
          code_sha256: code,
        })
      ).status,
    ).toBe(403);
    const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    expect((await web('/api/workshop/runs/' + s.request.id + '/cancel', {})).status).toBe(200);
    expect(
      (
        await api(s.token, `/jobs/${job.id}/complete`, {
          ...lease(job),
          frames: [],
        })
      ).status,
    ).toBe(409);
  });
  it('reviews a run beside its video: recordings, frames in capture order, class-limited label edits, and counts', async () => {
    const s = await setup({ interval: 30 }),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    await commit(s, job, 2, true, 30);
    // Another workflow's run, for the per-workflow list to leave out. Inserted directly: each setup() adds an API key, and keys are capped.
    const revision = (await (await web('/api/workshop')).json<WorkshopState>()).revision;
    const other = {
      ...(await workshopOps.run(env, s.request.id))!,
      id: crypto.randomUUID(),
      workflow_id: 'other-' + crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    await workshopOps.insertRun(
      env,
      other,
      [
        {
          id: other.id + '_0',
          cam: 'sky01',
          input_json: '{}',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          expected_images: 1,
        },
      ],
      revision,
    );
    expect(await workshopOps.run(env, other.id)).not.toBeNull();
    const review = await (await web(`/api/workshop/runs/${s.request.id}/review`)).json<WorkshopRunReview>();
    expect(review.run).toMatchObject({
      id: s.request.id,
      workflow_id: s.request.workflow_id,
      mode: 'run',
      output_buckets: [s.bucket],
    });
    expect(review.recordings).toEqual([
      expect.objectContaining({ cam: 'sky01', start: s.start.toISOString(), duration_s: 60, frames: 1800 }),
    ]);
    expect(review.items.map(i => i.captured_at)).toEqual([
      s.start.toISOString(),
      new Date(+s.start + 30000).toISOString(),
    ]);
    expect(review.classes).toEqual([
      {
        node_id: 'n2',
        classes: [
          { id: 0, name: 'Object' },
          { id: 1, name: 'Bird' },
        ],
      },
    ]);
    const [first, second] = review.items,
      label = JSON.parse(first.annotation_json)[0];
    const decide = (id: string, body: unknown) => web(`/api/workshop/items/${id}/review`, body, 'PUT');
    // A busy frame: as many labels as the service takes, as the website sends them, fit the body limit.
    const busy = Array.from({ length: 100 }, () => ({
      ...label,
      model_node: 'n2',
      track_id: 'track-' + '0'.repeat(32),
    }));
    expect((await decide(first.id, { review: 'pending', annotations: busy })).status).toBe(200);
    // Relabel within the model's classes only, with a real box.
    expect(
      (await decide(first.id, { review: 'accepted', annotations: [{ ...label, class_name: 'Cat' }] })).status,
    ).toBe(400);
    expect(
      (await decide(first.id, { review: 'accepted', annotations: [{ ...label, box: [0.5, 0.2, 0.3, 0.4] }] })).status,
    ).toBe(400);
    expect(
      (await decide(first.id, { review: 'accepted', annotations: [{ ...label, class_name: 'Bird', edited: false }] }))
        .status,
    ).toBe(200);
    expect((await decide(second.id, { review: 'rejected', annotations: [label] })).status).toBe(200);
    const after = await (await web(`/api/workshop/runs/${s.request.id}/review`)).json<WorkshopRunReview>();
    expect(JSON.parse(after.items[0].annotation_json)).toEqual([
      { ...label, class_id: 1, class_name: 'Bird', edited: true },
    ]);
    expect(JSON.parse(after.items[1].annotation_json)).toEqual([label]);
    expect(after.items.map(i => i.review)).toEqual(['accepted', 'rejected']);
    // The overview counts come from the same rows.
    const summary = await (await web('/api/workshop/summary')).json<WorkshopSummary>();
    const flow = summary.workflows.find(w => w.workflow_id === s.request.workflow_id)!;
    expect(flow).toMatchObject({
      runs: 1,
      images: 2,
      accepted: 1,
      rejected: 1,
      pending: 0,
      last_run: { id: s.request.id, completed: 1, images: 2, accepted: 1 },
    });
    expect(flow.classes).toEqual(
      expect.arrayContaining([
        { class_name: 'Bird', detections: 1, images: 1, accepted: 1, rejected: 0 },
        { class_name: 'Object', detections: 1, images: 1, accepted: 0, rejected: 1 },
      ]),
    );
    expect(flow.daily).toEqual([{ day: s.start.toISOString().slice(0, 10), images: 2 }]);
    expect(summary.buckets.find(b => b.bucket_id === s.bucket)).toMatchObject({
      images: 2,
      accepted: 1,
      rejected: 1,
      last_added_at: expect.any(String),
    });
    const runs = await (await web(`/api/workshop/runs?workflow=${s.request.workflow_id}`)).json<{
      runs: WorkshopRunStatus[];
    }>();
    expect(runs.runs.map(r => [r.id, r.pending, r.accepted, r.rejected])).toEqual([[s.request.id, 0, 1, 1]]);
    expect((await web('/api/workshop/runs/missing/review')).status).toBe(404);
    await s.revoke();
  });
});

describe('Workshop schedules', () => {
  // Footage is seeded on yesterday's UTC date; the scheduler runs at chosen times the next day.
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const at = (time: string) => new Date(Date.parse(`${day}T${time}Z`) + 86400000);
  async function clip(time: string, date = day) {
    const start = new Date(`${date}T${time}Z`);
    await seedSegment({ start });
    await env.CATALOG.prepare('UPDATE segments SET sha256=? WHERE start=?').bind(sourceHash, start.toISOString()).run();
  }
  async function patch(id: string, change: (w: WorkshopDocument['workflows'][number]) => void) {
    const state = await (await web('/api/workshop')).json<WorkshopState>();
    change(state.document.workflows.find(w => w.id === id)!);
    return web('/api/workshop', state, 'PUT');
  }
  async function scheduled(schedule: Record<string, unknown>, footage: Record<string, unknown>) {
    const s = await setup();
    await s.claim(); // the processor checks in, so scheduled runs have a runtime
    const response = await patch(s.request.workflow_id, w => {
      Object.assign(w.nodes[1].data, footage);
      w.nodes.push({
        id: 'n9',
        type: 'workshop',
        position: { x: 0, y: 0 },
        data: {
          kind: 'schedule',
          label: 'Schedule',
          trigger: 'time',
          days: [0, 1, 2, 3, 4, 5, 6],
          at: '',
          workflowId: '',
          onlyIf: false,
          ...schedule,
        },
      });
      w.edges.push({ id: 'e9', source: 'n9', target: 'n0', sourceHandle: 'out', targetHandle: 'in' });
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await s.revoke(); // the runtime has checked in; schedules never use the key
    return s.request.workflow_id;
  }
  const runs = async (workflow: string) =>
    (
      await env.CATALOG.prepare(
        "SELECT r.id,r.name,COUNT(j.id) AS jobs FROM workshop_runs r JOIN workshop_jobs j ON j.run_id=r.id WHERE r.workflow_id=? AND r.id LIKE 'sched%' GROUP BY r.id ORDER BY r.created_at",
      )
        .bind(workflow)
        .all<{ id: string; name: string; jobs: number }>()
    ).results;
  const outcome = (workflow: string) =>
    env.CATALOG.prepare('SELECT status,message FROM workshop_schedules WHERE workflow_id=?')
      .bind(workflow)
      .first<{ status: string; message: string }>();

  it('refuses a fixed recorded day, then runs the moving day once per slot', async () => {
    await clip('03:00:00');
    const flow = await scheduled({ at: '03:30' }, { day, from: '03:00:00', until: '03:05:00' });
    await runSchedules(env, at('03:31:00'));
    expect(await outcome(flow)).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('same recorded day every time'),
    });
    expect(await runs(flow)).toHaveLength(0);
    expect(
      (
        await patch(flow, w => {
          w.nodes[1].data.day = 'previous-day';
        })
      ).status,
    ).toBe(200);
    await runSchedules(env, at('03:32:00'));
    await runSchedules(env, at('03:40:00'));
    await runSchedules(env, at('04:31:00')); // past the slot's grace period
    expect(await runs(flow)).toEqual([
      expect.objectContaining({ name: expect.stringContaining('Scheduled 03:30 UTC'), jobs: 1 }),
    ]);
    expect(await outcome(flow)).toMatchObject({ status: 'started' });
  });
  it('waits for a same-day window to finish uploading', async () => {
    const flow = await scheduled({ at: '03:05' }, { day: 'run-day', from: '03:00:00', until: '03:05:00' });
    await runSchedules(env, at('03:06:00'));
    expect(await outcome(flow)).toMatchObject({
      status: 'failed',
      message: 'Schedule at 03:15 UTC or later so the whole window has been recorded and uploaded.',
    });
  });
  it('runs new footage once per quarter hour and only on recordings uploaded since', async () => {
    const today = at('00:00:00').toISOString().slice(0, 10);
    await clip('04:00:00', today);
    const flow = await scheduled({ trigger: 'arrival' }, { day: 'run-day', from: '04:00:00', until: '04:10:00' });
    await runSchedules(env, at('04:15:00'));
    await runSchedules(env, at('04:16:00'));
    expect(await runs(flow)).toEqual([
      expect.objectContaining({ name: expect.stringContaining('New footage'), jobs: 1 }),
    ]);
    await runSchedules(env, at('04:30:00'));
    expect(await outcome(flow)).toMatchObject({ status: 'skipped', message: 'Nothing new to process.' });
    await clip('04:02:00', today);
    await runSchedules(env, at('04:45:00'));
    const all = await runs(flow);
    expect(all.map(r => r.jobs)).toEqual([1, 1]);
    const [input] = (
      await env.CATALOG.prepare('SELECT input_json FROM workshop_jobs WHERE run_id=?')
        .bind(all[1].id)
        .all<{ input_json: string }>()
    ).results;
    expect(JSON.parse(input.input_json).recording.start).toBe(`${today}T04:02:00.000Z`);
  });
  it('refuses new-footage schedules that would miss uploads at midnight', async () => {
    const flow = await scheduled({ trigger: 'arrival' }, { day: 'previous-day', from: '04:00:00', until: '04:10:00' });
    await runSchedules(env, at('04:15:00'));
    expect((await outcome(flow))?.message).toContain('Choose Day of each run');
    await patch(flow, w => Object.assign(w.nodes[1].data, { day: 'run-day', from: '23:00:00', until: '23:50:00' }));
    await runSchedules(env, at('04:30:00'));
    expect((await outcome(flow))?.message).toBe(
      "End the window by 23:35 UTC so its last clips upload before the day's final new-footage check.",
    );
  });
  it('processes the day of a set-time slot that started late, after midnight', async () => {
    const before = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    await clip('06:00:00', before);
    await clip('06:00:00');
    const flow = await scheduled({ at: '23:50' }, { day: 'previous-day', from: '06:00:00', until: '06:05:00' });
    await runSchedules(env, at('00:20:00')); // yesterday's 23:50 slot, half an hour late
    const [run] = await runs(flow);
    const input = await env.CATALOG.prepare('SELECT input_json FROM workshop_jobs WHERE run_id=?')
      .bind(run.id)
      .first<{ input_json: string }>();
    expect(JSON.parse(input!.input_json).recording.start).toBe(`${before}T06:00:00.000Z`);
  });
  it('follows another workflow only when its finished run saved images', async () => {
    await clip('05:00:00');
    const first = await setup(),
      second = await setup();
    const follower = await scheduled(
      { trigger: 'workflow', workflowId: first.request.workflow_id, onlyIf: true },
      { day: 'previous-day', from: '05:00:00', until: '05:01:00' },
    );
    const complete = async (s: typeof first, keepImages: boolean) => {
      const { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
      await commit(s, job);
      // This fixture has no Do nothing branch, so a run that found nothing is simulated by removing its saved rows.
      if (!keepImages) await env.CATALOG.prepare('DELETE FROM workshop_items WHERE run_id=?').bind(s.request.id).run();
    };
    await runSchedules(env);
    expect(await outcome(follower)).toBeNull(); // nothing finished yet
    await complete(first, false);
    await runSchedules(env);
    expect(await outcome(follower)).toMatchObject({ status: 'skipped', message: 'The followed run saved no images.' });
    expect(
      (
        await patch(follower, w => {
          w.nodes.at(-1)!.data.workflowId = second.request.workflow_id;
        })
      ).status,
    ).toBe(200);
    await complete(second, true);
    await runSchedules(env);
    expect(await runs(follower)).toEqual([
      expect.objectContaining({ name: expect.stringContaining(`After ${second.request.workflow_id}`), jobs: 1 }),
    ]);
  });
  it('rejects workflows that start each other in a loop', async () => {
    // Plain workflows are enough here, so this test creates no processor keys.
    const follow = (id: string, target: string) => ({
      id,
      name: id,
      updatedAt: new Date().toISOString(),
      edges: [],
      nodes: [
        {
          id: 's',
          type: 'workshop' as const,
          position: { x: 0, y: 0 },
          data: {
            kind: 'schedule',
            label: 'Schedule',
            trigger: 'workflow',
            days: [],
            at: '',
            workflowId: target,
            onlyIf: false,
          },
        },
      ],
    });
    const [a, b] = [`loop-a-${crypto.randomUUID()}`, `loop-b-${crypto.randomUUID()}`];
    const state = await (await web('/api/workshop')).json<WorkshopState>();
    state.document.workflows.push(follow(a, b), follow(b, 'missing'));
    expect((await web('/api/workshop', state, 'PUT')).status).toBe(200);
    const loop = await patch(b, w => {
      w.nodes[0].data.workflowId = a;
    });
    expect(loop.status).toBe(400);
    expect(await loop.text()).toContain('cannot start each other in a loop');
  });
});

describe('Workshop tracks', () => {
  // A test user may hold 20 active keys, and earlier blocks leave their setup keys active once they are done.
  beforeAll(async () => {
    const { keys } = await (await web('/api/keys')).json<{
      keys: { id: string; name: string; revoked_at: string | null }[];
    }>();
    for (const key of keys.filter(k => k.name.startsWith('Workshop ') && !k.revoked_at))
      expect((await web(`/api/keys/${key.id}`, undefined, 'DELETE')).status).toBe(200);
  });
  // One plane followed across three detections and measured in every frame near this photo.
  const track = (job: string, extra: Record<string, unknown> = {}) => ({
    id: `${job}:1`,
    motion: 'moving',
    speed: 0.0123,
    start: 0,
    end: 2,
    detections: 3,
    clipped: ['start'],
    path: [
      [0, 0.2, 0.3, 0.2, 0.2, 0, 0.8],
      [1, 0.21, 0.3, 0.2, 0.2, 0, 0.82],
      [2, 0.22, 0.3, 0.2, 0.2, 0, 0.79],
    ],
    scan: {
      fps: 8.4,
      searched: 3,
      seen: 2,
      speed: 0.0121,
      first: 0,
      last: 0.119,
      samples: [
        [0, 0.2, 0.3, 41.5],
        [0.119, 0.201, 0.3, 39],
        [0.238, null, null, 0],
      ],
    },
    ...extra,
  });
  const tracked = (body: Awaited<ReturnType<typeof commit>>, job: string, t: object = track(job)) => ({
    ...body,
    frames: body.frames.map(f => ({
      ...f,
      annotations: f.annotations.map(a => ({ ...a, track_id: `${job}:1` })),
      tracks: [t],
    })),
  });

  it('runs a tracking workflow only on a processor that tracks, and pins how it picks frames', async () => {
    const s = await setup({ footage: { pick: 'change' } });
    const runtimes = await (await web('/api/workshop/runtimes')).json<{
      runtimes: { id: string; capabilities: string[] }[];
    }>();
    expect(runtimes.runtimes.find(r => r.id === s.runtime.id)!.capabilities).toContain('tracking');
    const { job } = await (await s.claim()).json<{ job: WorkshopJob & { snapshot: { pick?: string } } }>();
    expect(job.snapshot.pick).toBe('change');
    // A runtime registered before tracking existed keeps working for other workflows, but cannot take this one.
    const device = (s.runtime as unknown as { device_id: string }).device_id;
    const legacy = {
      id: 'workshop-legacy-' + crypto.randomUUID().slice(0, 8),
      device_id: device,
      code_sha256: 'e'.repeat(64),
      manifest_json: canonicalModel({
        schema_version: 1,
        engine: 'workshop-v2',
        device_id: device,
        code_sha256: 'e'.repeat(64),
      }),
      created_at: new Date().toISOString(),
      last_seen_at: null,
    };
    await workshopOps.registerRuntime(env, legacy);
    const listed = await (await web('/api/workshop/runtimes')).json<{
      runtimes: { id: string; capabilities: string[] }[];
    }>();
    expect(listed.runtimes.find(r => r.id === legacy.id)!.capabilities).toEqual(['test-runs', 'live-progress']);
    const refused = await web('/api/workshop/runs', { ...s.request, id: crypto.randomUUID(), runtime_id: legacy.id });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Update the Workshop processor');
    // The same workflow without change-picking runs there.
    const plain = s.state.document.workflows.find(w => w.id === s.request.workflow_id)!;
    plain.nodes[1].data.pick = 'first';
    const saved = await web('/api/workshop', { revision: s.request.revision, document: s.state.document }, 'PUT');
    expect(saved.status, await saved.clone().text()).toBe(200);
    const accepted = await web('/api/workshop/runs', {
      ...s.request,
      id: crypto.randomUUID(),
      runtime_id: legacy.id,
      revision: s.request.revision + 1,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(201);
    // Only first or change.
    plain.nodes[1].data.pick = 'brightest';
    const unknown = await web('/api/workshop', { revision: s.request.revision + 1, document: s.state.document }, 'PUT');
    expect(unknown.status).toBe(400);
    await s.revoke();
  });

  it('keeps a minute of frames that each carry a long track', async () => {
    // A fixed light seen all minute rides, with its whole path, in every frame: 1.7 MB of results.
    const s = await setup({ interval: 5 }),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>();
    const path = Array.from({ length: 4000 }, (_, i) => [i * 0.015, 0.2, 0.3, 0.002, 0.004, 0, 0.5]);
    const light = { ...track(job.id, { motion: 'stationary', speed: 0, end: 59.985, detections: 4000, path }) };
    delete (light as { scan?: unknown }).scan;
    const body = tracked(await commit(s, job, 12, false), job.id, light);
    expect(JSON.stringify(body).length).toBeGreaterThan(1_500_000);
    const response = await api(s.token, `/jobs/${job.id}/complete`, body);
    expect(response.status, await response.clone().text()).toBe(200);
    const { items } = await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>();
    expect(items.filter(i => i.job_id === job.id)).toHaveLength(12);
    await s.revoke();
  });

  it('keeps each frame with its tracks, refuses malformed ones, and exports them', async () => {
    const s = await setup(),
      { job } = await (await s.claim()).json<{ job: WorkshopJob }>(),
      body = tracked(await commit(s, job, 1, false), job.id);
    const send = (value: unknown) => api(s.token, `/jobs/${job.id}/complete`, value);
    const broken = (t: object) => tracked(body, job.id, t);
    for (const bad of [
      // Another job's track, named consistently by its box: only the job prefix tells them apart.
      tracked(body, 'x'.repeat(job.id.length)),
      broken(track(job.id, { motion: 'flying' })),
      broken(track(job.id, { detections: 2 })),
      broken(track(job.id, { path: [[0, 1.2, 0.3, 0.2, 0.2, 0, 0.8]], detections: 1 })),
      broken(track(job.id, { start: 3, end: 2 })),
      broken(track(job.id, { clipped: ['start', 'start'] })),
      broken(track(job.id, { colour: 'red' })),
      broken({ ...track(job.id), scan: { ...track(job.id).scan, seen: 4 } }),
      broken({ ...track(job.id), scan: { ...track(job.id).scan, samples: [[0, 0.2, null, 1]] } }),
      // A box must name a track the frame carries, and every track needs a box.
      {
        ...body,
        frames: body.frames.map(f => ({
          ...f,
          annotations: f.annotations.map(a => ({ ...a, track_id: `${job.id}:2` })),
        })),
      },
      { ...body, frames: body.frames.map(f => ({ ...f, annotations: f.annotations.map(({ track_id, ...a }) => a) })) },
    ]) {
      const response = await send(bad);
      expect(response.status, JSON.stringify(bad.frames[0].tracks ?? bad.frames[0].annotations)).toBe(400);
    }
    const response = await send(body);
    expect(response.status, await response.clone().text()).toBe(200);
    const [item] = (await (await web('/api/workshop/buckets/' + s.bucket)).json<{ items: WorkshopItem[] }>()).items;
    expect(JSON.parse(item.annotation_json)[0].track_id).toBe(`${job.id}:1`);
    expect(JSON.parse(item.provenance_json).tracks).toEqual([track(job.id)]);
    // A reviewer's adjusted box is the same object; a new box elsewhere is not; a client cannot claim a track.
    const label = JSON.parse(item.annotation_json)[0];
    const decided = await web(
      `/api/workshop/items/${item.id}/review`,
      {
        review: 'accepted',
        annotations: [
          { ...label, class_name: 'Bird', box: [0.11, 0.2, 0.3, 0.41] },
          { ...label, box: [0.6, 0.6, 0.7, 0.7], track_id: `${job.id}:1` },
        ],
      },
      'PUT',
    );
    expect(decided.status, await decided.clone().text()).toBe(200);
    const labels = (await decided.json<{ annotations: { track_id?: string; edited?: boolean }[] }>()).annotations;
    expect(labels.map(l => [l.track_id, l.edited])).toEqual([
      [`${job.id}:1`, true],
      [undefined, true],
    ]);
    const version = await (
      await web(`/api/workshop/buckets/${s.bucket}/versions`, { id: crypto.randomUUID(), name: 'Tracked' })
    ).json<WorkshopVersionSummary>();
    const manifest = (
      await (await web('/api/workshop/versions/' + version.id)).json<{ manifest: WorkshopVersionManifest }>()
    ).manifest;
    expect(manifest.items[0].provenance.tracks).toEqual([track(job.id)]);
    expect(manifest.items[0].annotations[0].track_id).toBe(`${job.id}:1`);
    await s.revoke();
  });

  it('routes on motion only after a model, and only with known motions', () => {
    const node = (id: string, data: Record<string, unknown>) => ({
      id,
      type: 'workshop' as const,
      position: { x: 0, y: 0 },
      data,
    });
    const edge = (id: string, source: string, target: string, sourceHandle = 'out') => ({
      id,
      source,
      target,
      sourceHandle,
      targetHandle: 'in',
    });
    const motion = (operator: string) => ({ id: 'rule', kind: 'motion', className: 'Plane', operator });
    const flow = (operator: string, beforeModel = false) => ({
      id: 'night',
      name: 'Night',
      updatedAt: '2026-10-25T00:00:00.000Z',
      nodes: [
        node('in', { kind: 'input', label: 'Input', bucketId: 'camera-archive', camera: 'sky01' }),
        node('foot', {
          kind: 'footage',
          label: 'Footage',
          day: '2026-10-25',
          from: '02:00',
          until: '09:30',
          interval: 1,
          pick: 'change',
        }),
        node('model', { kind: 'model', label: 'Model', modelKey: 'detector/v1', score: 0.3 }),
        node('gate', { kind: 'condition', label: 'Moving', match: 'any', rules: [motion(operator)] }),
        node('planes', { kind: 'output', label: 'Planes', bucketId: 'planes' }),
        node('stars', { kind: 'output', label: 'Stars', bucketId: 'stars' }),
      ],
      edges: beforeModel
        ? [
            edge('a', 'in', 'foot'),
            edge('b', 'foot', 'gate'),
            edge('c', 'gate', 'model', 'yes'),
            edge('d', 'gate', 'stars', 'no'),
            edge('e', 'model', 'planes'),
          ]
        : [
            edge('a', 'in', 'foot'),
            edge('b', 'foot', 'model'),
            edge('c', 'model', 'gate'),
            edge('d', 'gate', 'planes', 'yes'),
            edge('e', 'gate', 'stars', 'no'),
          ],
    });
    expect(executionGraph(flow('moving')).outputs).toHaveLength(2);
    expect(() => executionGraph(flow('fast'))).toThrow('Invalid motion condition');
    expect(() => executionGraph(flow('moving', true))).toThrow('Prediction conditions need an upstream model');
  });
});
