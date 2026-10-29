import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSource } from './check-architecture.mjs';
const inspect = (layer, name, text) => inspectSource(`/app/src/${layer}/${name}.ts`, text);
test('rejects SQL and database method extraction outside db', () => {
  assert.ok(
    inspect('service', 'footageStorageService', "const sql = 'SELECT * FROM segments';").some(s => s.includes('SQL')),
  );
  assert.ok(
    inspect('handler', 'footageStorageHandler', 'const p = env.CATALOG.prepare;').some(s => s.includes('persistence')),
  );
  assert.ok(
    inspect('service', 'footageStorageService', "db['prepare']('anything')").some(s => s.includes('persistence')),
  );
  assert.deepEqual(inspect('db', 'FootageStorageOps', "db.prepare('SELECT * FROM segments')"), []);
  assert.ok(inspect('service', 'footageStorageService', 'env.STORE.fetch(url)').some(s => s.includes('persistence')));
  assert.deepEqual(inspect('db', 'FootageStorageOps', 'env.STORE.fetch(url)'), []);
});
test('rejects bypassed layers and inline models', () => {
  assert.ok(
    inspect('handler', 'footageStorageHandler', "import { read } from '../db/FootageStorageOps';").some(s =>
      s.includes('cannot import'),
    ),
  );
  assert.ok(
    inspect('service', 'footageStorageService', 'interface Segment { start: string }').some(s => s.includes('models/')),
  );
  assert.ok(
    inspect('service', 'footageStorageService', 'function read(request: Request): Response {}').some(s =>
      s.includes('HTTP'),
    ),
  );
  assert.ok(
    inspect('db', 'FootageStorageOps', "import { read } from '../service/footageStorageService';").some(s =>
      s.includes('cannot import'),
    ),
  );
});
test('routes register named handlers without execution or business logic', () => {
  assert.deepEqual(
    inspect(
      'routes',
      'footageStorageRoute',
      "import { route } from '../../../shared/src/utils/routerSharedUtil'; import { read } from '../handler/footageStorageHandler'; export const routes = [route('GET', '/file', read)];",
    ),
    [],
  );
  assert.ok(
    inspect('routes', 'footageStorageRoute', "const routes = [route('GET', '/file', () => fetch('/other'))]").some(s =>
      s.includes('declarations only'),
    ),
  );
  assert.ok(
    inspect('routes', 'footageStorageRoute', "import { read } from '../service/footageStorageService';").some(s =>
      s.includes('cannot import'),
    ),
  );
});
test('reads the layer below src/, not from folders the checkout sits in', () => {
  const index = "import { routes } from './routes/statusStorageRoute'; export default { fetch(r: Request) {} };";
  assert.deepEqual(inspectSource('/home/me/service/openskycam/package/worker/src/index.ts', index), []);
  assert.ok(
    inspectSource('/home/me/service/openskycam/package/worker/src/db/x.ts', '').some(s => s.includes('filename')),
  );
});
