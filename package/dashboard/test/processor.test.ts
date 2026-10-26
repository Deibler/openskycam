import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { accessToken, minutesAgo, seedSegment } from './helpers';
import { sha256 } from '../../shared/src/utils/cryptoSharedUtil';
import worker from '../src/index';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

type Created = { token: string; key: { id: string } };
type Job = {
  id: string;
  generation: number;
  lease_token: string;
  input: { sha256: string };
  pipeline: { model_sha256: string; code_sha256: string; config_sha256: string };
};
const hash = 'a'.repeat(64);
// One base for the whole file: minutesAgo() rounds to the minute, so recomputing it per setup would give
// two setups the same start whenever the clock crosses a minute between them.
const seedBase = minutesAgo(1000);
let seedNumber = 0;
async function website(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return exports.default.fetch(
    new Request(`https://openskycam.test${path}`, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': await accessToken({ email: `${crypto.randomUUID()}@test.example` }),
        Origin: 'https://openskycam.test',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
function api(token: string, path: string, body: unknown = {}) {
  return exports.default.fetch(
    new Request(`https://api.example.com/v1/processor/jobs${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
async function setup(seed = true) {
  const pipeline = crypto.randomUUID();
  await env.CATALOG.prepare('INSERT INTO inference_pipelines VALUES (?, ?, ?, ?, ?, ?)')
    .bind(pipeline, hash, hash, hash, '{}', new Date().toISOString())
    .run();
  await env.CATALOG.prepare('INSERT INTO inference_subscriptions VALUES (?, ?, 1)').bind(pipeline, 'sky01').run();
  const created = await website('/api/keys', {
    name: 'GPU box',
    cameras: ['sky01'],
    expires_in_days: 1,
    scope: 'processor:run',
    pipeline_id: pipeline,
  });
  expect(created.status).toBe(201);
  const key = await created.json<Created>();
  const start = new Date(+seedBase - 60_000 * seedNumber++);
  if (seed) {
    await seedSegment({ start, body: new Uint8Array([1, 2, 3]) });
    // Seed helper uses 'x'; real catalog uses the ingest-verified SHA-256.
    await env.CATALOG.prepare('UPDATE segments SET sha256 = ? WHERE start = ?').bind(hash, start.toISOString()).run();
    await env.CATALOG.prepare('UPDATE inference_jobs SET input_sha256 = ? WHERE start = ?')
      .bind(hash, start.toISOString())
      .run();
  }
  return { pipeline, ...key, start };
}
async function claim(token: string) {
  const response = await api(token, '/claim', { camera: 'sky01' });
  expect(response.status).toBe(200);
  return (await response.json<{ job: Job | null }>()).job;
}
function result(job: Job, tracks: unknown[] = []) {
  return {
    provenance: {
      input_sha256: job.input.sha256,
      model_sha256: hash,
      code_sha256: hash,
      config_sha256: hash,
      runtime: { test: true },
    },
    metrics: { processed_seconds: 60, sampled_frames: 240, decoded_frames: 1800, elapsed_seconds: 45 },
    tracks,
  };
}
const lease = (job: Job) => ({ generation: job.generation, lease_token: job.lease_token });

describe('processor jobs', () => {
  it('keeps inference disabled unless explicitly enabled and requires a registered key scope', async () => {
    const ctx = createExecutionContext();
    const disabled = { ...env, INFERENCE_ENABLED: 'false' };
    const keyBody = {
      name: 'Processor',
      cameras: ['sky01'],
      expires_in_days: 1,
      scope: 'processor:run',
      pipeline_id: 'missing',
    };
    const request: Parameters<typeof worker.fetch>[0] = new Request('http://localhost:8789/api/keys', {
      method: 'POST',
      headers: { Origin: 'http://localhost:8789', 'Content-Type': 'application/json' },
      body: JSON.stringify(keyBody),
    });
    expect((await worker.fetch(request, disabled, ctx)).status).toBe(403);
    expect((await worker.fetch(new Request('http://localhost:8789/api/inference/status'), disabled, ctx)).status).toBe(
      404,
    );
    await waitOnExecutionContext(ctx);
    expect((await website('/api/keys', keyBody)).status).toBe(400);
    expect((await website('/api/keys', { ...keyBody, scope: 'admin' })).status).toBe(400);
    expect((await website('/api/keys', { ...keyBody, scope: 'footage:read' })).status).toBe(400);
  });
  it('atomically creates one job with an ingested segment and reconciles without duplicates', async () => {
    const s = await setup();
    const count = await env.CATALOG.prepare('SELECT COUNT(*) n FROM inference_jobs WHERE pipeline_id = ?')
      .bind(s.pipeline)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    const body = {
      pipeline_id: s.pipeline,
      camera: 'sky01',
      from: s.start.toISOString(),
      to: new Date(+s.start + 60_000).toISOString(),
    };
    expect(await (await website('/api/inference/reconcile', body)).json()).toEqual({ enqueued: 0 });
    expect((await claim(s.token))?.pipeline.model_sha256).toBe(hash);
    expect(await claim(s.token)).toBeNull();
  });
  it('does not create jobs until a camera subscription is enabled', async () => {
    const s = await setup(false);
    await env.CATALOG.prepare('UPDATE inference_subscriptions SET enabled = 0 WHERE pipeline_id = ?')
      .bind(s.pipeline)
      .run();
    await seedSegment({ start: s.start });
    expect(await claim(s.token)).toBeNull();
    await env.CATALOG.prepare('UPDATE inference_subscriptions SET enabled = 1 WHERE pipeline_id = ?')
      .bind(s.pipeline)
      .run();
    const response = await website('/api/inference/reconcile', {
      pipeline_id: s.pipeline,
      camera: 'sky01',
      from: s.start.toISOString(),
      to: new Date(+s.start + 60_000).toISOString(),
    });
    expect(await response.json()).toEqual({ enqueued: 1 });
  });
  it('rejects read-only keys, wrong cameras, wrong pipelines and missing credentials', async () => {
    const readOnly = await (
      await website('/api/keys', { name: 'Colab', cameras: ['sky01'], expires_in_days: 1 })
    ).json<Created>();
    expect((await api(readOnly.token, '/claim', { camera: 'sky01' })).status).toBe(403);
    expect((await api('', '/claim', { camera: 'sky01' })).status).toBe(401);
    const s = await setup();
    const job = (await claim(s.token))!;
    expect((await api(s.token, '/claim', { camera: 'other' })).status).toBe(403);
    const other = await setup(false);
    expect((await api(other.token, `/${job.id}/heartbeat`, lease(job))).status).toBe(404);
    await env.API_KEYS.prepare('UPDATE api_keys SET cameras = \'["other"]\' WHERE id = ?').bind(s.key.id).run();
    expect((await api(s.token, `/${job.id}/heartbeat`, lease(job))).status).toBe(403);
  });
  it('arbitrates simultaneous claims and fences an expired processor after reclaim', async () => {
    const s = await setup();
    const jobs = await Promise.all([claim(s.token), claim(s.token)]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
    const old = jobs.find(Boolean)!;
    await env.CATALOG.prepare('UPDATE inference_jobs SET lease_until = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), old.id)
      .run();
    expect((await api(s.token, `/${old.id}/heartbeat`, lease(old))).status).toBe(409);
    const fresh = (await claim(s.token))!;
    expect(fresh.generation).toBe(old.generation + 1);
    expect(fresh.lease_token).not.toBe(old.lease_token);
    expect((await api(s.token, `/${old.id}/complete`, { ...lease(old), result: result(old) })).status).toBe(409);
    expect((await api(s.token, `/${fresh.id}/heartbeat`, lease(fresh))).status).toBe(200);
  });
  it('commits verified results once, including zero-event coverage, without resetting expiry', async () => {
    const s = await setup();
    const job = (await claim(s.token))!;
    const body = { ...lease(job), result: result(job) };
    expect((await api(s.token, `/${job.id}/complete`, body)).status).toBe(200);
    expect((await api(s.token, `/${job.id}/complete`, body)).status).toBe(200);
    const modified = structuredClone(body);
    modified.result.metrics.elapsed_seconds = 46;
    expect((await api(s.token, `/${job.id}/complete`, modified)).status).toBe(409);
    const stored = await env.CATALOG.prepare('SELECT * FROM inference_jobs WHERE id = ?')
      .bind(job.id)
      .first<{ result_key: string; expires_at: string; status: string; processed_seconds: number }>();
    expect(stored?.status).toBe('completed');
    expect(stored?.processed_seconds).toBe(60);
    expect(stored?.expires_at).toBe(new Date(+s.start + 40 * 86400000).toISOString());
    expect(await (await env.EVIDENCE!.get(stored!.result_key))!.json()).toEqual(body.result);
    expect((await website(`/api/inference/jobs/${job.id}/result`)).status).toBe(200);
    await env.CATALOG.prepare('UPDATE inference_jobs SET expires_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), job.id)
      .run();
    expect((await website(`/api/inference/jobs/${job.id}/result`)).status).toBe(404);
    expect((await api(s.token, `/${job.id}/complete`, body)).status).toBe(409);
  });
  it('validates checksums, timestamps, full coverage and uploaded evidence before committing', async () => {
    const s = await setup();
    const job = (await claim(s.token))!;
    const track = {
      track_id: 1,
      label: 'wildlife',
      score: 0.9,
      evidence_sha256: hash,
      points: [
        { t: 1, box: [0.1, 0.2, 0.3, 0.4], score: 0.8 },
        { t: 2, box: [0.2, 0.2, 0.4, 0.4], score: 0.9 },
      ],
    };
    const r = result(job, [track]);
    expect((await api(s.token, `/${job.id}/complete`, { ...lease(job), result: r })).status).toBe(422);
    const jpeg = new Uint8Array([255, 216, 255, 217]);
    const digest = await sha256(jpeg.buffer);
    const put = (checksum: string, token = job.lease_token) =>
      exports.default.fetch(
        new Request(`https://api.example.com/v1/processor/jobs/${job.id}/evidence/${checksum}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${s.token}`,
            'Content-Type': 'image/jpeg',
            'X-Lease-Token': token,
            'X-Lease-Generation': String(job.generation),
          },
          body: jpeg,
        }),
      );
    expect((await put(digest, 'stale')).status).toBe(409);
    expect((await put(hash)).status).toBe(422);
    expect((await put(digest)).status).toBe(200);
    track.evidence_sha256 = digest;
    const wrongHash = structuredClone(r);
    wrongHash.provenance.input_sha256 = 'b'.repeat(64);
    expect((await api(s.token, `/${job.id}/complete`, { ...lease(job), result: wrongHash })).status).toBe(422);
    const partial = structuredClone(r);
    partial.metrics.processed_seconds = 3;
    expect((await api(s.token, `/${job.id}/complete`, { ...lease(job), result: partial })).status).toBe(422);
    const invalid = structuredClone(r);
    (invalid.tracks[0] as typeof track).points[1].t = 0;
    expect((await api(s.token, `/${job.id}/complete`, { ...lease(job), result: invalid })).status).toBe(422);
    expect((await api(s.token, `/${job.id}/complete`, { ...lease(job), result: r })).status).toBe(200);
    const event = await env.CATALOG.prepare('SELECT * FROM inference_events WHERE job_id = ?')
      .bind(job.id)
      .first<{ start: string; expires_at: string; label: string }>();
    expect(event?.label).toBe('wildlife');
    expect(event?.start).toBe(new Date(+s.start + 1000).toISOString());
    expect(event?.expires_at).toBe(new Date(+s.start + 1000 + 40 * 86400000).toISOString());
  });
  it('bounds retries and distinguishes unavailable footage from zero detections', async () => {
    const s = await setup();
    let job = (await claim(s.token))!;
    for (let i = 0; i < 3; i++) {
      const response = await api(s.token, `/${job.id}/fail`, { ...lease(job), error: 'decode_failed' });
      expect(await response.json()).toEqual({ status: i === 2 ? 'failed' : 'queued' });
      if (i < 2) {
        await env.CATALOG.prepare("UPDATE inference_jobs SET available_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
          .bind(job.id)
          .run();
        job = (await claim(s.token))!;
      }
    }
    expect(await claim(s.token)).toBeNull();
    const gone = await setup();
    await env.CATALOG.prepare('DELETE FROM segments WHERE start = ?').bind(gone.start.toISOString()).run();
    expect(await claim(gone.token)).toBeNull();
    expect(
      (await env.CATALOG.prepare('SELECT status FROM inference_jobs WHERE pipeline_id = ?').bind(gone.pipeline).first())
        ?.status,
    ).toBe('expired');
  });
});
