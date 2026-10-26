import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { accessToken, seedSegment } from './helpers';

type Key = {
  id: string;
  name: string;
  prefix: string;
  expires_at: string;
  revoked_at: string | null;
  cameras: string[];
};
type Created = { key: Key; token: string };
async function manage(
  path = '/api/keys',
  method = 'GET',
  body?: unknown,
  email = 'key-test@example.com',
  origin: string | null = 'https://openskycam.test',
) {
  const headers = new Headers({ 'Cf-Access-Jwt-Assertion': await accessToken({ email }) });
  if (origin) headers.set('Origin', origin);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return exports.default.fetch(
    new Request(`https://openskycam.test${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
async function create(email = `${crypto.randomUUID()}@example.com`): Promise<Created & { owner: string }> {
  const response = await manage('/api/keys', 'POST', { name: 'Colab', cameras: ['sky01'], expires_in_days: 90 }, email);
  expect(response.status).toBe(201);
  return { ...(await response.json<Created>()), owner: email };
}
function api(path: string, token?: string, headers: Record<string, string> = {}, method = 'GET') {
  return exports.default.fetch(
    new Request(path.startsWith('https://') ? path : `https://api.example.com${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    }),
  );
}

describe('website API key management', () => {
  it('reveals a generated secret once, persists only a hash, and lists masked metadata', async () => {
    const key = await create();
    expect(key.token).toMatch(/^svk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);
    const stored = await env.API_KEYS.prepare('SELECT * FROM api_keys WHERE id = ?').bind(key.key.id).first();
    expect(JSON.stringify(stored)).not.toContain(key.token);
    expect(stored?.secret_hash).toMatch(/^[a-f0-9]{64}$/);
    const listed = await manage('/api/keys', 'GET', undefined, key.owner);
    expect(listed.headers.get('Cache-Control')).toBe('no-store');
    const list = await listed.text();
    expect(list).not.toContain(key.token);
    expect(list).not.toContain('secret_hash');
    expect(list).toContain(key.key.prefix);
    const identity = await api('/v1/me', key.token);
    expect(identity.status).toBe(200);
    expect(await identity.json()).toEqual({ key_id: key.key.id, scope: 'footage:read', cameras: ['sky01'] });
  });
  it('isolates lists, renames, rotation, and revocation by owner', async () => {
    const key = await create();
    const other = 'other-owner@example.com';
    expect((await manage('/api/keys', 'GET', undefined, other)).status).toBe(200);
    expect(await (await manage('/api/keys', 'GET', undefined, other)).text()).not.toContain(key.key.id);
    expect((await manage(`/api/keys/${key.key.id}`, 'PATCH', { name: 'Stolen' }, other)).status).toBe(404);
    expect((await manage(`/api/keys/${key.key.id}`, 'DELETE', undefined, other)).status).toBe(404);
    expect((await manage(`/api/keys/${key.key.id}/rotate`, 'POST', undefined, other)).status).toBe(404);
    expect((await api('/v1/me', key.token)).status).toBe(200);
  });
  it('requires a browser session and matching Origin for mutations', async () => {
    const key = await create();
    for (const origin of [null, 'https://attacker.test'])
      expect((await manage(`/api/keys/${key.key.id}`, 'DELETE', undefined, key.owner, origin)).status).toBe(403);
    expect(
      (await manage('/api/keys', 'POST', { name: 'No owner', cameras: ['sky01'], expires_in_days: 30 }, '')).status,
    ).toBe(403);
    const attempt = await exports.default.fetch(
      new Request('https://openskycam.test/api/keys', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key.token}`,
          Origin: 'https://openskycam.test',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(attempt.status).toBe(403);
  });
  it('renames without changing credentials and rotates without extending permissions or expiry', async () => {
    const key = await create();
    expect((await manage(`/api/keys/${key.key.id}`, 'PATCH', { name: 'GPU server' }, key.owner)).status).toBe(200);
    expect((await api('/v1/me', key.token)).status).toBe(200);
    const rotatedResponse = await manage(`/api/keys/${key.key.id}/rotate`, 'POST', undefined, key.owner);
    expect(rotatedResponse.headers.get('Cache-Control')).toBe('no-store');
    const rotated = await rotatedResponse.json<Created>();
    expect(rotated.key).toMatchObject({ name: 'GPU server', cameras: key.key.cameras, expires_at: key.key.expires_at });
    expect(rotated.token).not.toBe(key.token);
    expect((await api('/v1/me', key.token)).status).toBe(401);
    expect((await api('/v1/me', rotated.token)).status).toBe(200);
  });
  it('revokes immediately and cannot rotate a revoked key', async () => {
    const key = await create();
    expect((await api('/v1/me', key.token)).status).toBe(200);
    expect((await manage(`/api/keys/${key.key.id}`, 'DELETE', undefined, key.owner)).status).toBe(200);
    expect((await api('/v1/me', key.token)).status).toBe(401);
    expect((await manage(`/api/keys/${key.key.id}`, 'DELETE', undefined, key.owner)).status).toBe(200);
    expect((await manage(`/api/keys/${key.key.id}/rotate`, 'POST', undefined, key.owner)).status).toBe(404);
  });
  it.each([
    { name: '', cameras: ['sky01'], expires_in_days: 90 },
    { name: 'x', cameras: [], expires_in_days: 90 },
    { name: 'x', cameras: ['other'], expires_in_days: 90 },
    { name: 'x', cameras: ['sky01'], expires_in_days: 0 },
    { name: 'x', cameras: ['sky01'], expires_in_days: 366 },
  ])('rejects invalid key configuration %#', async body => {
    expect((await manage('/api/keys', 'POST', body)).status).toBe(400);
  });
  it('caps active keys per owner and frees a slot after revocation', async () => {
    const owner = `${crypto.randomUUID()}@example.com`;
    const keys: Created[] = [];
    for (let i = 0; i < 20; i++) keys.push(await create(owner));
    expect(
      (await manage('/api/keys', 'POST', { name: 'Extra', cameras: ['sky01'], expires_in_days: 1 }, owner)).status,
    ).toBe(409);
    await manage(`/api/keys/${keys[0].key.id}`, 'DELETE', undefined, owner);
    expect((await create(owner)).token).toBeTruthy();
  });
  it('keeps older active keys visible after more than 200 revoked keys', async () => {
    const key = await create();
    await env.API_KEYS.prepare(`WITH RECURSIVE sequence(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM sequence WHERE i < 201)
      INSERT INTO api_keys (id, owner, name, secret_hash, prefix, cameras, created_at, expires_at, revoked_at)
      SELECT ? || i, ?, 'Old test key', '', 'masked', '["sky01"]', '2099-01-01T00:00:00.000Z', '2099-01-02T00:00:00.000Z', '2099-01-01T00:00:00.000Z' FROM sequence`)
      .bind(`${key.key.id}-`, key.owner)
      .run();
    const listed = await (await manage('/api/keys', 'GET', undefined, key.owner)).json<{ keys: Key[] }>();
    expect(listed.keys).toHaveLength(200);
    expect(listed.keys[0].id).toBe(key.key.id);
  });
  it.each([
    ['text/plain', '{}', 415],
    ['application/json', '[1,2]', 400],
    ['application/json', '{broken', 400],
    ['application/json', JSON.stringify({ name: 'x'.repeat(5000) }), 413],
  ])('bounds and validates credential request body %#', async (type, body, status) => {
    const response = await exports.default.fetch(
      new Request('https://openskycam.test/api/keys', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': await accessToken(),
          Origin: 'https://openskycam.test',
          'Content-Type': String(type),
        },
        body: String(body),
      }),
    );
    expect(response.status).toBe(status);
  });
});

describe('machine API boundaries and transfers', () => {
  it('rejects missing, malformed, wrong, and expired secrets, including on localhost', async () => {
    const key = await create();
    for (const token of [undefined, 'bad', `${key.token.slice(0, -2)}aa`]) {
      const response = await api('/v1/me', token);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
    }
    expect((await exports.default.fetch(new Request('http://localhost:8787/v1/me'))).status).toBe(401);
    await env.API_KEYS.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', key.key.id)
      .run();
    expect((await api('/v1/me', key.token)).status).toBe(401);
  });
  it('never exposes the website or key-management routes on the API hostname', async () => {
    const key = await create();
    for (const path of ['/', '/theme.js', '/api/keys', '/api/overview'])
      expect((await api(path, key.token)).status).toBe(404);
    expect((await api('/v1/me', key.token, {}, 'POST')).status).toBe(405);
    expect((await api('/v1/unknown', key.token)).status).toBe(404);
    expect((await api('/v1/recordings/nope/20260922T193000Z/file', key.token)).status).toBe(403);
  });
  it('serves checksummed metadata, complete files, HEAD, and resumable byte ranges', async () => {
    const key = await create();
    const body = new Uint8Array(1000).map((_, i) => i % 251);
    const start = await seedSegment({ start: new Date('2026-09-20T12:00:00Z'), body });
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), b =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    await env.CATALOG.prepare('UPDATE segments SET sha256 = ? WHERE cam = ? AND start = ?')
      .bind(sha, 'sky01', '2026-09-20T12:00:00.000Z')
      .run();
    const query = await api('/v1/recordings?camera=sky01&from=2026-09-20T12:00:30Z&to=2026-09-20T12:01:00Z', key.token);
    const page = await query.json<{ recordings: { sha256: string; download_url: string }[] }>();
    expect(page.recordings).toHaveLength(1);
    expect(page.recordings[0].sha256).toBe(sha);
    const file = `/v1/recordings/sky01/${start}/file`;
    const full = await api(file, key.token);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(body);
    const head = await api(file, key.token, {}, 'HEAD');
    expect(head.headers.get('Content-Length')).toBe('1000');
    expect(await head.text()).toBe('');
    const partial = await api(file, key.token, { Range: 'bytes=300-' });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Range')).toBe('bytes 300-999/1000');
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(body.slice(300));
    for (const range of ['bytes=bad', 'bytes=0-1,4-5', 'bytes=1001-']) {
      const invalid = await api(file, key.token, { Range: range });
      expect(invalid.status).toBe(416);
      await invalid.text();
    }
  });
  it('paginates stably, excludes later uploads, and rejects a cursor reused with another query', async () => {
    const key = await create();
    for (const minute of [0, 1, 2]) await seedSegment({ start: new Date(`2026-09-19T10:0${minute}:00Z`) });
    const path = '/v1/recordings?camera=sky01&from=2026-09-19T10:00:00Z&to=2026-09-19T11:00:00Z&limit=2';
    const first = await (await api(path, key.token)).json<{
      recordings: { start: string }[];
      next_url: string;
      next_cursor: string;
    }>();
    expect(first.recordings).toHaveLength(2);
    await seedSegment({ start: new Date('2026-09-19T10:03:00Z'), uploaded: new Date(Date.now() + 60000) });
    const second = await (await api(first.next_url, key.token)).json<{
      recordings: { start: string }[];
      next_url: string | null;
    }>();
    expect(second.recordings.map(r => r.start)).toEqual(['2026-09-19T10:02:00.000Z']);
    expect(second.next_url).toBeNull();
    const changed = first.next_url
      .replace('2026-09-19T10%3A00%3A00Z', '2026-09-19T09%3A00%3A00Z')
      .replace('2026-09-19T10:00:00Z', '2026-09-19T09:00:00Z');
    expect((await api(changed, key.token)).status).toBe(400);
  });
  it.each(['limit=0', 'limit=501', 'limit=abc', 'cursor=bad'])('rejects malformed pagination: %s', async extra => {
    const key = await create();
    expect(
      (await api(`/v1/recordings?camera=sky01&from=2026-09-20T12:00:00Z&to=2026-09-20T13:00:00Z&${extra}`, key.token))
        .status,
    ).toBe(400);
  });
  it('serves an OpenAPI contract for every machine route without requiring a key', async () => {
    const response = await api('/openapi.json');
    expect(response.status).toBe(200);
    const spec = await response.json<{
      openapi: string;
      paths: Record<string, object>;
      components: { securitySchemes: { ApiKey: { scheme: string } } };
    }>();
    expect(spec.openapi).toBe('3.1.1');
    expect(spec.components.securitySchemes.ApiKey.scheme).toBe('bearer');
    for (const path of [
      '/v1/me',
      '/v1/cameras',
      '/v1/recordings',
      '/v1/recordings/{camera}/{start}/file',
      '/api/keys',
      '/api/keys/{id}',
      '/api/keys/{id}/rotate',
    ])
      expect(spec.paths[path]).toBeTruthy();
  });
});
