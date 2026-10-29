import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeAll } from 'vitest';
import { accessToken, minutesAgo, seedSegment } from './helpers';
import { sha256 } from '../../shared/src/utils/cryptoSharedUtil';
import type { WorkshopJob, WorkshopNode } from '../src/models/workshopInferencemodel';
import { place } from '../src/utils/agentSharedUtil';

// A separate owner, so these keys never count against other test files' key limits.
const OWNER = 'agent@example.test';
const code = 'e'.repeat(64),
  modelHash = 'c'.repeat(64);
const jpeg = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);

async function web(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return exports.default.fetch(
    new Request('https://openskycam.test' + path, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': await accessToken({ email: OWNER }),
        Origin: 'https://openskycam.test',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
async function key(scope: string, extra: Record<string, unknown> = {}) {
  const response = await web('/api/keys', {
    name: scope + ' ' + crypto.randomUUID().slice(0, 8),
    cameras: ['sky01'],
    expires_in_days: 1,
    scope,
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<{ token: string; key: { id: string } }>();
}
function rpc(token: string | null, message: unknown, method = 'POST') {
  return exports.default.fetch(
    new Request('https://api.example.com/v1/mcp', {
      method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(message) } : {}),
    }),
  );
}
interface ToolResult {
  content: { type: string; text?: string; data?: string }[];
  isError?: boolean;
}
async function call(token: string, name: string, args: Record<string, unknown>) {
  const response = await rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  expect(response.status).toBe(200);
  const { result } = await response.json<{ result: ToolResult }>();
  const text = result.content.find(c => c.type === 'text')!.text!;
  return {
    result,
    error: result.isError ? text : null,
    body: result.isError || name === 'guide' ? null : JSON.parse(text),
  };
}
async function ok(token: string, name: string, args: Record<string, unknown>) {
  const r = await call(token, name, args);
  expect(r.error).toBeNull();
  return r.body;
}
const fetchLink = (url: string) => exports.default.fetch(new Request(url));
/** A stored one-minute clip with the checksum runs require. */
async function clip(start: Date, durationS?: number) {
  await seedSegment({ start, durationS });
  await env.CATALOG.prepare('UPDATE segments SET sha256=? WHERE start=?')
    .bind('b'.repeat(64), start.toISOString())
    .run();
}

/** A registered model and a Workshop processor the tests drive by hand. */
async function processor() {
  const device = 'agent-device-' + crypto.randomUUID().slice(0, 8),
    family = 'agent-model-' + crypto.randomUUID().slice(0, 8);
  await web('/api/models/devices', { id: device });
  const runtime = await (await web('/api/workshop/runtimes', { device_id: device, code_sha256: code })).json<{
    id: string;
  }>();
  const { token } = await key('workshop:run', { device_id: device });
  const model = {
    family,
    version: 'v1',
    name: 'Full frame model',
    description: 'Test',
    task: 'object-detection',
    adapter: 'ultralytics',
    input: { width: 640 },
    classes: [
      { id: 0, name: 'Plane' },
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
  const machine = (path: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
    exports.default.fetch(
      new Request('https://api.example.com/v1/workshop' + path, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers },
        body: body instanceof Uint8Array ? body : JSON.stringify(body),
      }),
    );
  const claim = async () =>
    (
      await (
        await machine('/claim', { runtime_id: runtime.id, code_sha256: code })
      ).json<{
        job: (WorkshopJob & { snapshot: { models: unknown[] }; input: { from: number; until: number } }) | null;
      }>()
    ).job;
  await claim(); // checks in, so runs and photos go to this runtime
  /** Upload one frame and finish the job, as a processor would. */
  async function finish(job: WorkshopJob, frame: Record<string, unknown>) {
    const digest = await sha256(jpeg.buffer);
    const lease = { generation: job.generation, lease_token: job.lease_token };
    expect(
      (
        await machine(
          `/jobs/${job.id}/images/${digest}`,
          jpeg,
          { 'X-Lease-Token': job.lease_token!, 'X-Lease-Generation': String(job.generation) },
          'PUT',
        )
      ).status,
    ).toBe(200);
    const done = await machine(`/jobs/${job.id}/complete`, {
      ...lease,
      code_sha256: code,
      sampled_frames: 1,
      frames: [{ sha256: digest, pts: 0, time_base: [1, 30], width: 640, height: 480, ...frame }],
    });
    expect(done.status, await done.clone().text()).toBe(200);
  }
  return { family, runtime, claim, finish, machine };
}

let agent: { token: string; key: { id: string } };
beforeAll(async () => {
  agent = await key('agent');
});

describe('Agent MCP server', () => {
  it('places an added step in a free row of its column, never on top of an existing step', () => {
    const step = (id: string, kind: string, x = NaN, y = NaN): WorkshopNode => ({
      id,
      type: 'workshop',
      position: { x, y },
      data: { kind },
    });
    const link = (source: string, target: string) => ({
      id: source + target,
      source,
      target,
      sourceHandle: 'out',
      targetHandle: 'in',
    });
    const nodes = [
      step('in', 'input', 0, 100),
      step('m', 'model', 320, 100),
      step('out', 'output', 640, 100),
      step('drop', 'nothing'),
      step('more', 'nothing'),
    ];
    place(nodes, [link('in', 'm'), link('m', 'out'), link('m', 'drop'), link('m', 'more')]);
    expect(nodes.slice(3).map(n => n.position)).toEqual([
      { x: 640, y: 290 },
      { x: 640, y: 480 },
    ]);
  });
  it('requires an Agent key and speaks stateless MCP over HTTP', async () => {
    expect((await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status).toBe(401);
    const processorKey = await key('footage:read');
    expect((await rpc(processorKey.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status).toBe(
      403,
    );
    const init = await (
      await rpc(agent.token, {
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      })
    ).json<{ id: number; result: { protocolVersion: string; instructions: string; serverInfo: { name: string } } }>();
    expect(init).toMatchObject({
      id: 7,
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'openskycam' } },
    });
    expect(init.result.instructions.length).toBeLessThanOrEqual(2048); // Claude Code truncates beyond this
    expect((await rpc(agent.token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc(agent.token, null, 'GET')).status).toBe(405);
    const { result } = await (await rpc(agent.token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json<{
      result: { tools: { name: string; inputSchema: object }[] };
    }>();
    expect(result.tools.map(t => t.name)).toEqual([
      'guide',
      'footage',
      'workflows',
      'runs',
      'images',
      'buckets',
      'models',
    ]);
    const missing = await (await rpc(agent.token, { jsonrpc: '2.0', id: 3, method: 'sampling/createMessage' })).json<{
      error: { code: number };
    }>();
    expect(missing.error.code).toBe(-32601);
  });

  it('serves every guide and skill as a tool page, a resource, and (skills) a prompt', async () => {
    const index = await call(agent.token, 'guide', {});
    const names = [...index.result.content[0].text!.matchAll(/^- ([a-z-]+):/gm)].map(m => m[1]);
    expect(names.length).toBe(11);
    for (const topic of names) {
      const page = await call(agent.token, 'guide', { topic });
      expect(page.result.isError, topic).toBeFalsy();
      expect(page.result.content[0].text!.startsWith('# '), topic).toBe(true);
    }
    const { result: resources } = await (
      await rpc(agent.token, { jsonrpc: '2.0', id: 1, method: 'resources/list' })
    ).json<{ result: { resources: { uri: string }[] } }>();
    const read = await (
      await rpc(agent.token, {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/read',
        params: { uri: resources.resources[0].uri },
      })
    ).json<{ result: { contents: { text: string }[] } }>();
    expect(read.result.contents[0].text).toContain('# openskycam: start here');
    const prompt = await (
      await rpc(agent.token, { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'verify-changes' } })
    ).json<{ result: { messages: { content: { text: string } }[] } }>();
    expect(prompt.result.messages[0].content.text).toContain('Skill: verify your changes');
  });

  it('takes a photo before the Workshop document was ever saved, and again after it failed', async () => {
    const p = await processor();
    const start = minutesAgo(600);
    await clip(start);
    const at = new Date(+start + 5_000).toISOString();
    const failed = await ok(agent.token, 'footage', { action: 'photo', at, wait_seconds: 0 });
    const first = (await p.claim())!;
    expect(first.run_id).toBe(failed.photo_id);
    const lease = { generation: first.generation, lease_token: first.lease_token };
    expect((await p.machine(`/jobs/${first.id}/fail`, { ...lease, error: 'decode_failed' })).status).toBe(200);
    // Asking again makes a new photo instead of handing back the failed one.
    const again = await ok(agent.token, 'footage', { action: 'photo', at, wait_seconds: 0 });
    expect(again.photo_id).not.toBe(failed.photo_id);
    const job = (await p.claim())!;
    expect(job.run_id).toBe(again.photo_id);
    await p.finish(job, { bucket_id: 'camera-archive', model_node: null, offset: 5, annotations: [] });
    expect((await ok(agent.token, 'footage', { action: 'photo', at, wait_seconds: 0 })).photo_id).toBe(again.photo_id);
  });

  it('builds a workflow, protects edits with revisions, test-runs it, and wakes a watch on live progress', async () => {
    const p = await processor();
    const start = minutesAgo(90);
    await clip(start);
    const bucket = await ok(agent.token, 'buckets', { action: 'create', name: 'Agent planes ' + p.family });
    expect(
      (await call(agent.token, 'buckets', { action: 'create', name: 'agent PLANES ' + p.family })).error,
    ).toContain('already exists');
    const at = start.toISOString();
    const created = await ok(agent.token, 'workflows', {
      action: 'create',
      name: 'Planes',
      steps: [
        { id: 'input', kind: 'input', camera: 'sky01' },
        {
          id: 'footage',
          kind: 'footage',
          day: at.slice(0, 10),
          from: at.slice(11, 19),
          until: new Date(+start + 60000).toISOString().slice(11, 19),
          interval: 30,
        },
        { id: 'detect', kind: 'model', modelKey: p.family + '/v1', score: 0.4 },
        { id: 'keep', kind: 'output', bucketId: 'Agent planes ' + p.family }, // a bucket name resolves to its ID
      ],
      links: [
        { from: 'input', to: 'footage' },
        { from: 'footage', to: 'detect' },
        { from: 'detect', to: 'keep' },
      ],
    });
    expect(created).toMatchObject({ ready: true, issue: null });
    expect(created.steps.find((s: { id: string }) => s.id === 'keep').bucketId).toBe(bucket.bucket_id);
    // A key for sky01 cannot save a workflow, or a schedule the cron would run, for another camera.
    expect(
      (
        await call(agent.token, 'workflows', {
          action: 'create',
          name: 'Elsewhere',
          steps: [{ id: 'input', kind: 'input', camera: 'sky02' }],
        })
      ).error,
    ).toContain('cannot access that camera');
    const id = created.workflow_id;
    expect(
      (
        await call(agent.token, 'workflows', {
          action: 'update',
          workflow_id: id,
          revision: created.revision - 1,
          steps: [],
        })
      ).error,
    ).toContain(`Pass revision ${created.revision}`);
    expect(
      (
        await call(agent.token, 'workflows', {
          action: 'update',
          workflow_id: id,
          revision: created.revision,
          steps: [{ id: 'detect', kind: 'model', color: 'red' }],
        })
      ).error,
    ).toContain('has no setting color');
    // Changing one setting keeps the step's other settings; dropping a link leaves a readable draft.
    const edited = await ok(agent.token, 'workflows', {
      action: 'update',
      workflow_id: id,
      revision: created.revision,
      steps: created.steps.map((s: { id: string; kind: string }) =>
        s.id === 'detect' ? { id: 'detect', kind: 'model', score: 0.25 } : s,
      ),
      links: created.links.slice(0, 2),
    });
    expect(edited.steps.find((s: { id: string }) => s.id === 'detect')).toMatchObject({
      modelKey: p.family + '/v1',
      score: 0.25,
    });
    expect(edited).toMatchObject({ ready: false, issue: 'Connect every output port.' });
    const fixed = await ok(agent.token, 'workflows', {
      action: 'update',
      workflow_id: id,
      revision: edited.revision,
      links: created.links,
    });
    expect(fixed.ready).toBe(true);
    expect((await ok(agent.token, 'workflows', { action: 'check', workflow_id: id })).footage).toMatchObject({
      clips: 1,
      estimated_images: 2,
    });

    const test = await ok(agent.token, 'runs', { action: 'test', workflow_id: id, image_limit: 1 });
    expect(test.expected_images).toBe(1);
    const job = (await p.claim())!;
    expect(job.run_id).toBe(test.run_id);
    // The watch joins the run's live session and returns on the processor's next update, not at its timeout.
    const began = Date.now();
    const watching = call(agent.token, 'runs', { action: 'watch', run_id: test.run_id, wait_seconds: 20 });
    await new Promise(resolve => setTimeout(resolve, 300));
    await p.machine(`/jobs/${job.id}/progress`, {
      generation: job.generation,
      lease_token: job.lease_token,
      phase: 'processing',
      node_id: 'detect',
      processed: 0,
    });
    const watched = (await watching).body;
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(watched).toMatchObject({
      changed: true,
      finished: false,
      status: 'running',
      working_on: [{ phase: 'processing', step: 'Full frame model' }],
    });
    await p.finish(job, {
      bucket_id: bucket.bucket_id,
      model_node: 'detect',
      offset: job.input.from,
      annotations: [
        { class_id: 0, class_name: 'Plane', confidence: 0.9, box: [0.1, 0.1, 0.2, 0.2], model_node: 'detect' },
      ],
    });
    const finished = await ok(agent.token, 'runs', { action: 'watch', run_id: test.run_id, wait_seconds: 5 });
    expect(finished).toMatchObject({ finished: true, status: 'completed', images: { processed: 1, expected: 1 } });
    expect(finished.latest_images[0].detections.top[0]).toMatchObject({ class: 'Plane', confidence: 0.9 });
    const view = await call(agent.token, 'images', {
      action: 'view',
      run_id: test.run_id,
      image_ids: [finished.latest_images[0].image_id],
    });
    expect(view.body).toMatchObject({ width: 640, height: 480 });
    // The footage store makes the preview (the fake answers with what it was asked).
    expect(atob(view.result.content.find(c => c.type === 'image')!.data!)).toMatch(/^thumbnail\?size=\d+$/);

    const preview = await ok(agent.token, 'workflows', { action: 'delete', workflow_id: id });
    expect(preview.would_delete).toMatchObject({ kind: 'workflow', id });
    expect(
      (await ok(agent.token, 'workflows', { action: 'list' })).workflows.some(
        (w: { workflow_id: string }) => w.workflow_id === id,
      ),
    ).toBe(true);
    await ok(agent.token, 'workflows', {
      action: 'delete',
      workflow_id: id,
      confirm: true,
      revision: preview.would_delete.revision,
    });
    expect(
      (await ok(agent.token, 'workflows', { action: 'list' })).workflows.some(
        (w: { workflow_id: string }) => w.workflow_id === id,
      ),
    ).toBe(false);
  });

  it('takes a photo from stored video through the processor and hands back a link that dies with its key', async () => {
    const p = await processor();
    const start = minutesAgo(200);
    await clip(start);
    const at = new Date(+start + 12_500).toISOString();
    const pending = await ok(agent.token, 'footage', { action: 'photo', at, wait_seconds: 0 });
    expect(pending.photo_id).toMatch(/^photo_[a-f0-9]{32}$/);
    // Asking again for the same moment reuses the queued photo.
    expect((await ok(agent.token, 'footage', { action: 'photo', at, wait_seconds: 0 })).photo_id).toBe(
      pending.photo_id,
    );
    const job = (await p.claim())!;
    expect(job.run_id).toBe(pending.photo_id);
    expect(job.snapshot.models).toEqual([]);
    expect(job.input).toMatchObject({ from: 12.5, until: 13.5 });
    await p.finish(job, { bucket_id: 'camera-archive', model_node: null, offset: 12.5, annotations: [] });
    const photo = await ok(agent.token, 'footage', { action: 'photo', photo_id: pending.photo_id, wait_seconds: 5 });
    expect(photo).toMatchObject({
      photo_id: pending.photo_id,
      camera: 'sky01',
      captured_at: at,
      width: 640,
      height: 480,
    });
    // Photos are runs, but they never crowd the Workshop's run list.
    const listed = await (await web('/api/workshop/runs')).json<{ runs: { id: string }[] }>();
    expect(listed.runs.some(r => r.id === pending.photo_id)).toBe(false);

    const link = photo.full_size.url as string;
    const image = await fetchLink(link);
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
    // Change one signature digit; always to a different value, or a signature starting with 0 would stay valid.
    const forged = link.replace(/sig=([a-f0-9])/, (_, digit: string) => `sig=${digit === '0' ? '1' : '0'}`);
    expect(forged).not.toBe(link);
    expect((await fetchLink(forged)).status).toBe(401);
    expect((await fetchLink(link.replace('/image?', '/image?extra=1&'))).status).toBe(401);
    expect((await exports.default.fetch(new Request(link, { method: 'DELETE' }))).status).toBe(401);
    expect(
      await ok(agent.token, 'footage', {
        action: 'photo',
        at: new Date(+start - 3600_000).toISOString(),
        wait_seconds: 0,
      }).catch(() => null),
    ).toBeNull;
    expect(
      (await call(agent.token, 'footage', { action: 'photo', at: new Date(+start - 3600_000).toISOString() })).error,
    ).toContain('No stored sky01 recording covers');

    const temporary = await key('agent');
    const [download] = (await ok(temporary.token, 'footage', { action: 'download', at })).files;
    expect((await call(temporary.token, 'footage', { action: 'download', at: 'noon' })).error).toContain(
      'at must be an ISO 8601 timestamp',
    );
    expect(download.filename).toMatch(/^sky01_\d{8}T\d{6}Z\.mp4$/);
    expect((await fetchLink(download.url)).status).toBe(404); // signed and authorized; the test clip has no bytes in the store
    expect((await web(`/api/keys/${temporary.key.id}`, undefined, 'DELETE')).status).toBe(200);
    expect((await fetchLink(download.url)).status).toBe(401);
  });

  it('takes a photo from the newest recording at that time, not an older one that runs past its last frame', async () => {
    const p = await processor();
    // Night clips at 8 fps: this one lasts 63.063 s, but its last frame starts at 62.94 s.
    const older = minutesAgo(900),
      newer = new Date(+older + 63_000);
    await clip(older, 63.063);
    await clip(newer);
    await ok(agent.token, 'footage', { action: 'photo', at: newer.toISOString(), wait_seconds: 0 });
    const job = (await p.claim())!;
    expect(job.input).toMatchObject({ recording: { start: newer.toISOString() }, from: 0, until: 1 });
  });

  it('searches saved detections by class and confidence, and records reviews', async () => {
    const p = await processor();
    const start = minutesAgo(300);
    await clip(start);
    const bucket = await ok(agent.token, 'buckets', { action: 'create', name: 'Agent search ' + p.family });
    const at = start.toISOString();
    const flow = await ok(agent.token, 'workflows', {
      action: 'create',
      name: 'Search',
      steps: [
        { id: 'input', kind: 'input', camera: 'sky01' },
        {
          id: 'footage',
          kind: 'footage',
          day: at.slice(0, 10),
          from: at.slice(11, 19),
          until: new Date(+start + 30000).toISOString().slice(11, 19),
          interval: 30,
        },
        { id: 'detect', kind: 'model', modelKey: p.family + '/v1' },
        { id: 'keep', kind: 'output', bucketId: bucket.bucket_id },
      ],
      links: [
        { from: 'input', to: 'footage' },
        { from: 'footage', to: 'detect' },
        { from: 'detect', to: 'keep' },
      ],
    });
    const run = await ok(agent.token, 'runs', { action: 'start', workflow_id: flow.workflow_id });
    const job = (await p.claim())!;
    await p.finish(job, {
      bucket_id: bucket.bucket_id,
      model_node: 'detect',
      offset: 0,
      annotations: [
        { class_id: 1, class_name: 'Bird', confidence: 0.55, box: [0.4, 0.4, 0.5, 0.5], model_node: 'detect' },
      ],
    });
    const search = (args: Record<string, unknown>) =>
      ok(agent.token, 'images', { action: 'search', bucket_id: bucket.bucket_id, ...args });
    expect((await search({ class: 'bird' })).images).toHaveLength(1);
    expect((await search({ class: 'Bird', min_confidence: 0.6 })).images).toHaveLength(0);
    expect((await search({ class: 'Plane' })).images).toHaveLength(0);
    const [found] = (await search({ run_id: run.run_id, min_confidence: 0.5 })).images;
    expect(found.detections.top[0]).toEqual({ class: 'Bird', confidence: 0.55, box: [0.4, 0.4, 0.5, 0.5] });
    await ok(agent.token, 'images', { action: 'review', image_ids: [found.image_id], decision: 'accepted' });
    expect((await search({ status: 'accepted' })).images.map((i: { image_id: string }) => i.image_id)).toEqual([
      found.image_id,
    ]);
    const counted = (await ok(agent.token, 'buckets', { action: 'list' })).buckets.find(
      (b: { bucket_id: string }) => b.bucket_id === bucket.bucket_id,
    );
    expect(counted).toMatchObject({ images: 1, accepted: 1, pending: 0, used_by: ['Search'] });
    const [linked] = (await ok(agent.token, 'images', { action: 'link', image_ids: [found.image_id] })).images;
    expect(new Uint8Array(await (await fetchLink(linked.url)).arrayBuffer())).toEqual(jpeg);
  });

  it('runs one workflow at a time on the processor, queues the next, and lets photos through', async () => {
    const p = await processor();
    const start = minutesAgo(400);
    await clip(start);
    const bucket = await ok(agent.token, 'buckets', { action: 'create', name: 'Agent queue ' + p.family });
    const at = start.toISOString();
    const flow = await ok(agent.token, 'workflows', {
      action: 'create',
      name: 'Queue',
      steps: [
        { id: 'input', kind: 'input', camera: 'sky01' },
        {
          id: 'footage',
          kind: 'footage',
          day: at.slice(0, 10),
          from: at.slice(11, 19),
          until: new Date(+start + 30000).toISOString().slice(11, 19),
          interval: 30,
        },
        { id: 'detect', kind: 'model', modelKey: p.family + '/v1' },
        { id: 'keep', kind: 'output', bucketId: bucket.bucket_id },
      ],
      links: [
        { from: 'input', to: 'footage' },
        { from: 'footage', to: 'detect' },
        { from: 'detect', to: 'keep' },
      ],
    });
    const first = await ok(agent.token, 'runs', { action: 'start', workflow_id: flow.workflow_id });
    const second = await ok(agent.token, 'runs', { action: 'test', workflow_id: flow.workflow_id, image_limit: 1 });
    expect(first.waiting_behind).toEqual([]);
    expect(second.waiting_behind).toEqual([{ run_id: first.run_id, name: 'Queue' }]);
    // A photo is one frame: it goes ahead of recordings already waiting.
    const photo = await ok(agent.token, 'footage', {
      action: 'photo',
      at: new Date(+start + 5000).toISOString(),
      wait_seconds: 0,
    });
    const photoJob = (await p.claim())!;
    expect(photoJob.run_id).toBe(photo.photo_id);
    const job = (await p.claim())!;
    expect(job.run_id).toBe(first.run_id);
    // A worker is free, but the second run waits until the first has no unfinished recordings.
    expect(await p.claim()).toBeNull();
    expect(await ok(agent.token, 'runs', { action: 'status', run_id: second.run_id })).toMatchObject({
      status: 'queued',
      waiting_behind: [{ run_id: first.run_id }],
    });
    await p.finish(photoJob, { bucket_id: 'camera-archive', model_node: null, offset: 5, annotations: [] });
    expect(await p.claim()).toBeNull();
    await p.finish(job, { bucket_id: bucket.bucket_id, model_node: 'detect', offset: 0, annotations: [] });
    expect((await p.claim())!.run_id).toBe(second.run_id);
  });
});
