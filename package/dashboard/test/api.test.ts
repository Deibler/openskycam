import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeAll } from 'vitest';
import { accessToken } from './helpers';
import { routes } from '../src/index';
import { requireFullAccess } from '../src/service/credentialSharedService';
import type { ApiPrincipal } from '../src/models/credentialSharedmodel';
import type { Env } from '../src/models/applicationSharedmodel';

// A separate owner, so these keys never count against other test files' key limits.
const OWNER = 'api@example.test';
async function web(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  origin = 'https://openskycam.test',
) {
  return exports.default.fetch(
    new Request('https://openskycam.test' + path, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': await accessToken({ email: OWNER }),
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
async function key(scope: string) {
  const response = await web('/api/keys', {
    name: scope + ' ' + crypto.randomUUID().slice(0, 8),
    cameras: ['sky01'],
    expires_in_days: 1,
    scope,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json<{ token: string }>()).token;
}
/** A key's request to the API host: no browser, so no Origin header. */
function v1(token: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return exports.default.fetch(
    new Request('https://api.example.com' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
interface Workshop {
  revision: number;
  document: { buckets: { id: string }[] };
}

let agent: string;
beforeAll(async () => {
  agent = await key('agent');
});

describe('the website API through /v1', () => {
  it('lets an Agent key for every camera change Workshop and follow the links it returns', async () => {
    const state = await (await v1(agent, '/v1/workshop')).json<Workshop>();
    const bucket = 'api-bucket-' + crypto.randomUUID().slice(0, 8);
    state.document.buckets.push({
      id: bucket,
      kind: 'labeled',
      name: bucket,
      description: '',
      createdAt: new Date().toISOString(),
    } as { id: string });
    const saved = await v1(agent, '/v1/workshop', state, 'PUT');
    expect(saved.status, await saved.clone().text()).toBe(200);
    const site = await (await web('/api/workshop')).json<Workshop>();
    expect(site.document.buckets.map(b => b.id)).toContain(bucket);

    const id = 'api-item-' + crypto.randomUUID().slice(0, 8),
      later = new Date(Date.now() + 86_400_000).toISOString(),
      jpeg = new Uint8Array([255, 216, 9, 255, 217]);
    await env.WORKSHOP.put(`test/${id}.jpg`, jpeg);
    await env.CATALOG.prepare('INSERT INTO workshop_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(
        id,
        bucket,
        'asset',
        'run',
        'job',
        'b'.repeat(64),
        'sky01',
        new Date().toISOString(),
        `test/${id}.jpg`,
        'a'.repeat(64),
        later,
        '[]',
        '{}',
        'pending',
        new Date().toISOString(),
      )
      .run();
    const contents = await (await v1(agent, `/v1/workshop/buckets/${bucket}`)).json<{
      items: { image_url: string }[];
    }>();
    expect(contents.items.map(i => i.image_url)).toEqual([`/v1/workshop/items/${id}/image`]);
    const image = await v1(agent, contents.items[0].image_url);
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
    expect((await v1(agent, '/v1/models')).status).toBe(200);
  });

  it('refuses other keys, and never manages API keys', async () => {
    const read = await key('footage:read');
    expect((await v1(read, '/v1/workshop')).status).toBe(403);
    expect(
      (await v1(read, '/v1/recordings?camera=sky01&from=2026-09-20T12:00:00Z&to=2026-09-20T13:00:00Z')).status,
    ).toBe(200);
    expect((await v1(agent, '/v1/keys')).status).toBe(404);
    expect((await v1(agent, '/v1/keys', { name: 'more', cameras: ['sky01'], scope: 'agent' })).status).toBe(404);
    expect((await v1(agent, '/v1/nothing-here')).status).toBe(404);

    const principal = (scope: string, cameras: string[]) =>
      ({ id: 'k', scope, cameras, pipeline_id: null }) as ApiPrincipal;
    const two = { ...env, CAMERAS: 'sky01,sky02' } as Env;
    expect(() => requireFullAccess(two, principal('agent', ['sky01', 'sky02']))).not.toThrow();
    expect(() => requireFullAccess(two, principal('agent', ['sky01']))).toThrow('every camera');
    expect(() => requireFullAccess(two, principal('footage:read', ['sky01', 'sky02']))).toThrow('every camera');
  });

  it('lets only this website change data from a browser', async () => {
    const changes = routes.filter(r => r.method !== 'GET');
    expect(changes.length).toBeGreaterThanOrEqual(16);
    for (const route of changes) {
      const path = route.pattern.pathname.replace(/:\w+/g, 'x');
      const response = await web(path, {}, route.method, 'https://elsewhere.example');
      expect(response.status, `${route.method} ${path}`).toBe(403);
      expect(await response.text()).toContain('same-origin');
    }
  });
});
