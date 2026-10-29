import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { withKeyPaths } from '../src/utils/openapiSharedUtil.ts';

test('the downloadable OpenAPI document validates and gives operations unique IDs', async () => {
  const document = await SwaggerParser.validate(new URL('../openapi.json', import.meta.url).pathname);
  assert.equal(document.openapi, '3.1.1');
  const ids = Object.values(document.paths).flatMap(path =>
    Object.entries(path)
      .filter(([method]) => ['get', 'head', 'post', 'patch', 'delete'].includes(method))
      .map(([, operation]) => operation.operationId),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Boolean));
});

test('every key scope the database accepts is in the document', () => {
  const migrations = new URL('../db/migrations/', import.meta.url);
  const latest = readdirSync(migrations)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .findLast(f => readFileSync(new URL(f, migrations), 'utf8').includes('CHECK(scope IN'));
  const accepted = readFileSync(new URL(latest, migrations), 'utf8').match(/CHECK\(scope IN \(([^)]*)\)/)[1];
  const scopes = [...accepted.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  const text = readFileSync(new URL('../openapi.json', import.meta.url), 'utf8');
  const enums = [...text.matchAll(/"enum": \[("footage:read"[^\]]*)\]/g)].map(m => JSON.parse(`[${m[1]}]`).sort());
  assert.ok(enums.length >= 3);
  for (const listed of enums) assert.deepEqual(listed, scopes);
});

test('the served document adds every website operation under /v1 for keys, except key management', async () => {
  const file = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  const served = withKeyPaths(structuredClone(file));
  const document = await SwaggerParser.validate(structuredClone(served));
  const operations = Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'put', 'post', 'patch', 'delete'].includes(method))
      .map(([method, operation]) => ({ path, method, operation })),
  );
  const ids = operations.map(o => o.operation.operationId);
  assert.equal(new Set(ids).size, ids.length);
  const website = operations.filter(o => o.path.startsWith('/api/') && !o.path.startsWith('/api/keys'));
  assert.ok(website.length >= 30);
  for (const { path, method } of website) {
    const twin = served.paths[`/v1/${path.slice(5)}`]?.[method];
    assert.ok(twin, `${method} ${path} has no /v1 twin`);
    assert.ok(
      (twin.security ?? served.security).some(s => 'ApiKey' in s),
      `${method} ${path} twin takes a key`,
    );
    assert.equal(twin.servers, undefined);
  }
  assert.ok(!Object.keys(served.paths).some(p => p.startsWith('/v1/keys')));
  // Machine endpoints that share a path keep their own operations.
  assert.deepEqual(served.paths['/v1/models'].post, file.paths['/v1/models'].post);
  assert.equal(served.paths['/v1/models'].get.operationId, file.paths['/v1/models'].get.operationId);
});
