import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deploymentConfig } from './deploy-config.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const { experimental_readRawConfig } = createRequire(path.join(process.cwd(), 'package.json'))('wrangler');
const read = worker => experimental_readRawConfig({ config: path.join(here, '..', worker, 'wrangler.jsonc') }).rawConfig;
const scopes = config => [config, ...Object.values(config.env ?? {})];
const env = {
  SITE_HOST: 'sky.example.com',
  API_HOST: 'api.sky.example.com',
  ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
  ACCESS_AUD: 'aud',
  CAMERAS: 'cam1',
  STORE_SERVICE_ID: 'service',
};

test('wrangler.jsonc holds no deployment hosts or account IDs', () => {
  for (const worker of ['dashboard', 'worker']) {
    const config = read(worker);
    assert.equal(config.routes, undefined, worker);
    for (const scope of scopes(config)) {
      for (const service of scope.vpc_services ?? []) assert.equal(service.service_id, undefined, worker);
      for (const database of scope.d1_databases ?? [])
        if (database.remote !== false) assert.equal(database.database_id, undefined, worker);
    }
  }
});

test('names every value a deployment must provide', () => {
  assert.deepEqual(deploymentConfig(read('worker'), {}).missing.sort(), ['CAMERAS', 'STORE_SERVICE_ID']);
  assert.deepEqual(
    deploymentConfig(read('dashboard'), {}, ['SITE_HOST', 'API_HOST']).missing.sort(),
    ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'API_HOST', 'CAMERAS', 'SITE_HOST', 'STORE_SERVICE_ID'],
  );
});

test('fills the deployment values and keeps fixed ones', () => {
  const { config, missing } = deploymentConfig(read('dashboard'), { ...env, D1_DATABASE_ID: 'db' }, [
    'SITE_HOST',
    'API_HOST',
  ]);
  assert.deepEqual(missing, []);
  assert.deepEqual(config.routes, [
    { pattern: 'sky.example.com', custom_domain: true },
    { pattern: 'api.sky.example.com', custom_domain: true },
  ]);
  for (const scope of scopes(config)) {
    assert.ok(!Object.values(scope.vars).includes(''));
    for (const service of scope.vpc_services ?? []) assert.equal(service.service_id, 'service');
    for (const database of scope.d1_databases ?? []) assert.ok(database.database_id);
  }
  assert.equal(config.vars.API_HOST, 'api.sky.example.com');
  assert.equal(config.env.inference.vars.ACCESS_AUD, 'local-inference');
  assert.equal(config.env.dev.d1_databases.find(d => d.binding === 'API_KEYS').database_id, 'skyvision-api-keys-local');
});
