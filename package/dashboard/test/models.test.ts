import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { accessToken } from './helpers';
import { sha256 } from '../../shared/src/utils/cryptoSharedUtil';
import type { ModelVersion, ModelDeployment, ModelCatalog } from '../src/models/modelInferencemodel';
import nightCard from '../../../models/night-detector/model.json';

async function web(path: string, method = 'GET', body?: unknown) {
  return exports.default.fetch(
    new Request(`https://openskycam.test${path}`, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': await accessToken(),
        Origin: 'https://openskycam.test',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function key(scope: string, device?: string) {
  const response = await web('/api/keys', 'POST', {
    name: 'registry-test',
    scope,
    cameras: scope.startsWith('models:') ? [] : ['sky01'],
    expires_in_days: 1,
    ...(device ? { device_id: device } : {}),
  });
  expect(response.status).toBe(201);
  return (await response.json<{ token: string }>()).token;
}
function api(path: string, token: string, method = 'GET', body?: unknown) {
  const binary = body instanceof Uint8Array;
  return exports.default.fetch(
    new Request(`https://api.example.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': binary ? 'application/octet-stream' : 'application/json',
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    }),
  );
}
async function artifact(token: string, data = 'model bytes') {
  const bytes = new TextEncoder().encode(data);
  const sha = await sha256(data);
  expect((await api(`/v1/models/chunks/${sha}`, token, 'PUT', bytes)).status).toBe(200);
  const result = await api('/v1/models/artifacts', token, 'POST', {
    sha256: sha,
    bytes: bytes.length,
    chunks: [{ sha256: sha, bytes: bytes.length }],
  });
  expect(result.status).toBe(200);
  return { sha256: sha, bytes: bytes.length, filename: 'best.pt', format: 'pytorch-checkpoint' };
}
async function model(token: string, label: string): Promise<ModelVersion> {
  const body = {
    family: label,
    version: 'v1',
    name: 'Test detector',
    description: 'An integration fixture',
    task: 'object-detection',
    adapter: 'ultralytics',
    classes: [{ id: 0, name: 'Bird' }],
    input: { training_size: 640 },
    evaluations: [],
    caveats: [],
    dependencies: [],
    artifacts: [await artifact(token, label)],
  };
  const response = await api('/v1/models', token, 'POST', body);
  expect(response.status).toBe(201);
  return response.json<ModelVersion>();
}
const selection = (m: ModelVersion) => ({
  slot: 'detector',
  family: m.family,
  version: m.version,
  sha256: m.artifacts[0].sha256,
  parameters: { imgsz: 640, confidence: 0.3, iou: 0.5, device: 'auto' },
});

describe('immutable model publishing and device assignments', () => {
  it('verifies chunks and whole files, streams original bytes, and is safe to retry', async () => {
    const token = await key('models:write');
    const bytes = new TextEncoder().encode('wrong');
    expect((await api(`/v1/models/chunks/${'a'.repeat(64)}`, token, 'PUT', bytes)).status).toBe(422);
    const a = await artifact(token, 'verified model');
    const download = await api(`/v1/models/artifacts/${a.sha256}`, token);
    expect(download.status).toBe(200);
    expect(download.headers.get('Content-Length')).toBe(String(a.bytes));
    expect(await download.text()).toBe('verified model');
    expect(
      (await api('/v1/models/artifacts', token, 'POST', { sha256: a.sha256, bytes: a.bytes, chunks: [] })).status,
    ).toBe(200);
    expect(
      (
        await api('/v1/models/artifacts', token, 'POST', {
          sha256: 'c'.repeat(64),
          bytes: a.bytes,
          chunks: [{ sha256: a.sha256, bytes: a.bytes }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await api('/v1/models/artifacts', token, 'POST', {
          sha256: 'd'.repeat(64),
          bytes: 100,
          chunks: [{ sha256: 'd'.repeat(64), bytes: 100 }],
        })
      ).status,
    ).toBe(422);
  });
  it('publishes the night detector card shipped in models/night-detector', async () => {
    const token = await key('models:write');
    const weights = { ...(await artifact(token, 'night weights')), filename: 'night-yolo26s-1920.pt' };
    const response = await api('/v1/models', token, 'POST', { ...nightCard, artifacts: [weights] });
    expect(response.status).toBe(201);
    const published = await response.json<ModelVersion>();
    expect(published.classes).toEqual([
      { id: 0, name: 'Plane' },
      { id: 1, name: 'Meteorite' },
    ]);
  });
  it('preserves class IDs and metrics and refuses to overwrite a model version', async () => {
    const token = await key('models:write');
    const m = await model(token, 'immutable-test');
    expect((await api('/v1/models', token, 'POST', m)).status).toBe(201);
    expect((await api('/v1/models', token, 'POST', { ...m, description: 'Changed' })).status).toBe(409);
    expect(
      (await api('/v1/models', token, 'POST', { ...m, version: 'v2', classes: [{ id: 1, name: 'Bird' }] })).status,
    ).toBe(400);
    expect(
      (
        await api('/v1/models', token, 'POST', {
          ...m,
          version: 'v2',
          artifacts: [{ ...m.artifacts[0], sha256: 'f'.repeat(64) }],
        })
      ).status,
    ).toBe(400);
    const listed = await (await web('/api/models')).json<{ models: ModelVersion[] }>();
    expect(listed.models.find(v => v.family === m.family)?.classes).toEqual([{ id: 0, name: 'Bird' }]);
  });
  it('accepts an explicit creation timestamp without confusing it with library registration', async () => {
    const token = await key('models:write');
    const m = await model(token, 'model-dates-test');
    const dated = { ...m, version: 'dated', created_at: '2026-06-06T22:56:46.794Z' };
    expect((await api('/v1/models', token, 'POST', dated)).status).toBe(201);
    expect((await api('/v1/models', token, 'POST', dated)).status).toBe(201);
    for (const date of ['2026-02-30T00:00:00Z', '2026-06-06', '2026-06-06T10:00:00']) {
      expect((await api('/v1/models', token, 'POST', { ...m, version: 'bad-date', created_at: date })).status).toBe(
        400,
      );
    }
    const { models } = await (await web('/api/models')).json<ModelCatalog>();
    const entry = models.find(model => model.family === m.family && model.version === 'dated')!;
    expect(entry.creation).toEqual({
      date: dated.created_at,
      source: 'publisher',
      legacy_date: null,
      status: 'available',
    });
    expect(entry.registered_at).not.toBe(dated.created_at);
    expect(models.find(model => model.family === m.family && model.version === 'v1')!.creation.date).toBeNull();
  });
  it('isolates publisher, device, and footage credentials; fences concurrent deployment edits', async () => {
    const publisher = await key('models:write');
    const footage = await key('footage:read');
    await web('/api/models/devices', 'POST', { id: 'test-mini' });
    const sync = await key('models:sync', 'test-mini');
    const m = await model(publisher, 'device-test');
    expect((await api('/v1/models', footage)).status).toBe(403);
    expect((await api('/v1/models', sync)).status).toBe(403);
    expect((await api('/v1/recordings?camera=sky01', publisher)).status).toBe(403);
    expect((await api('/v1/models/chunks/' + m.artifacts[0].sha256, sync, 'PUT', new Uint8Array([1]))).status).toBe(
      403,
    );
    expect((await api(`/v1/models/artifacts/${m.artifacts[0].sha256}`, sync)).status).toBe(403);
    const assignment = { previous_revision: null, models: [selection(m)] };
    const deployed = await web('/api/models/devices/test-mini/deployment', 'PUT', assignment);
    expect(deployed.status).toBe(200);
    const spec = await deployed.json<ModelDeployment>();
    expect((await web('/api/models/devices/test-mini/deployment', 'PUT', assignment)).status).toBe(409);
    expect((await api('/v1/models/devices/gpu-box/desired', sync)).status).toBe(403);
    expect((await api('/v1/models/devices/test-mini/desired', publisher)).status).toBe(403);
    const wanted = await (await api('/v1/models/devices/test-mini/desired', sync)).json<{
      deployment: ModelDeployment;
    }>();
    expect(wanted.deployment).toEqual(spec);
    expect(await (await api(`/v1/models/artifacts/${m.artifacts[0].sha256}`, sync)).text()).toBe('device-test');
    expect(
      (
        await api('/v1/models/devices/test-mini/status', sync, 'POST', {
          revision: spec.revision,
          active_revision: spec.revision,
          status: 'ready',
        })
      ).status,
    ).toBe(200);
    const next = await web('/api/models/devices/test-mini/deployment', 'PUT', {
      previous_revision: spec.revision,
      models: [],
    });
    expect(next.status).toBe(200);
    await api('/v1/models/devices/test-mini/status', sync, 'POST', {
      revision: spec.revision,
      active_revision: spec.revision,
      status: 'ready',
    });
    const row = await env.CATALOG.prepare('SELECT * FROM model_devices WHERE id = ?').bind('test-mini').first();
    expect(row?.status).toBe('pending');
    expect(row?.reported_revision).toBe(spec.revision);
    expect((await api(`/v1/models/artifacts/${m.artifacts[0].sha256}`, sync)).status).toBe(403);
    expect(
      (
        await env.CATALOG.prepare('SELECT COUNT(*) AS n FROM model_deployments WHERE device_id = ?')
          .bind('test-mini')
          .first()
      )?.n,
    ).toBe(2);
  });
  it('rejects unsupported runtime models and invalid or ignored parameters', async () => {
    const token = await key('models:write');
    const m = await model(token, 'parameters-test');
    await web('/api/models/devices', 'POST', { id: 'params-mini' });
    for (const parameters of [
      { ...selection(m).parameters, imgsz: 99999 },
      { ...selection(m).parameters, confidence: 2 },
      { ...selection(m).parameters, unnoticed: true },
      { ...selection(m).parameters, device: 'tpu' },
    ]) {
      expect(
        (
          await web('/api/models/devices/params-mini/deployment', 'PUT', {
            previous_revision: null,
            models: [{ ...selection(m), parameters }],
          })
        ).status,
      ).toBe(400);
    }
    await web('/api/models/devices', 'POST', { id: 'cuda-mini' });
    const cuda = { ...selection(m), parameters: { ...selection(m).parameters, device: 'cuda' } };
    const onCuda = await web('/api/models/devices/cuda-mini/deployment', 'PUT', {
      previous_revision: null,
      models: [cuda],
    });
    expect(onCuda.status).toBe(200);
    const unsupported = { ...m, version: 'custom', adapter: 'unsupported' };
    expect((await api('/v1/models', token, 'POST', unsupported)).status).toBe(201);
    expect(
      (
        await web('/api/models/devices/params-mini/deployment', 'PUT', {
          previous_revision: null,
          models: [{ ...selection(m), version: 'custom' }],
        })
      ).status,
    ).toBe(400);
  });
});
