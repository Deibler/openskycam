import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { modelCatalog } from '../src/service/modelCatalogInferenceService';
import { sha256 } from '../../shared/src/utils/cryptoSharedUtil';
import type { ModelVersion } from '../src/models/modelInferencemodel';

async function importedModel(family: string) {
  const model: ModelVersion = {
    family,
    version: 'v1',
    name: 'Imported model',
    description: 'Historical fixture',
    adapter: 'ultralytics',
    task: 'object-detection',
    classes: [{ id: 0, name: 'Car' }],
    input: {},
    evaluations: [],
    caveats: [],
    dependencies: [],
    artifacts: [{ sha256: 'a'.repeat(64), bytes: 10, filename: 'weights.pt', format: 'pytorch-checkpoint' }],
    source_manifest: `models/${family}/v1/manifest.json`,
  };
  await env.CATALOG.prepare('INSERT INTO model_versions VALUES (?, ?, ?, ?)')
    .bind(family, 'v1', JSON.stringify(model), '2026-09-23T20:30:00.000Z')
    .run();
  return model;
}
async function snapshot(
  model: ModelVersion,
  training: Record<string, string>,
  artifactSha = model.artifacts[0].sha256,
  corrupt = false,
) {
  const text = JSON.stringify({
    schema_version: 1,
    models: [{ family: model.family, version: model.version, training, artifacts: [{ sha256: artifactSha }] }],
  });
  const sha = await sha256(text),
    key = `catalogs/2026-09-23/${sha}/catalog.json`;
  await env.MODELS.put(key, corrupt ? text + ' ' : text);
  await env.MODELS.put(
    'registry/latest.json',
    JSON.stringify({ schema_version: 1, catalog_key: key, catalog_sha256: sha }),
  );
}

describe('model creation metadata', () => {
  it('reads verified dates with conflicting provenance without changing the immutable record', async () => {
    const model = await importedModel('dated-import');
    await snapshot(model, {
      checkpoint_date_as_recorded: '2026-06-07T20:07:51.627841',
      legacy_manifest_trained_at: '2026-06-08',
    });
    const { models } = await modelCatalog(env);
    const entry = models.find(item => item.family === model.family)!;
    expect(entry.creation).toEqual({
      date: '2026-06-07T20:07:51.627841',
      source: 'checkpoint',
      legacy_date: '2026-06-08',
      status: 'available',
    });
    expect(entry.registered_at).toBe('2026-09-23T20:30:00.000Z');
    const stored = await env.CATALOG.prepare('SELECT manifest_json FROM model_versions WHERE family = ?')
      .bind(model.family)
      .first<{ manifest_json: string }>();
    expect(JSON.parse(stored!.manifest_json)).toEqual(model);
  });
  it('distinguishes absent historical dates from unavailable metadata and does not guess a date', async () => {
    const model = await importedModel('undated-import');
    await snapshot(model, {});
    expect((await modelCatalog(env)).models.find(item => item.family === model.family)!.creation).toMatchObject({
      date: null,
      status: 'not-recorded',
    });
    await env.MODELS.delete('registry/latest.json');
    expect((await modelCatalog(env)).models.find(item => item.family === model.family)!.creation).toMatchObject({
      date: null,
      status: 'unavailable',
    });
  });
  it('rejects corrupted metadata and metadata for different weights', async () => {
    const model = await importedModel('verified-import');
    await snapshot(model, { checkpoint_date_as_recorded: '2026-06-06' }, 'b'.repeat(64));
    expect((await modelCatalog(env)).models.find(item => item.family === model.family)!.creation.date).toBeNull();
    await snapshot(model, { checkpoint_date_as_recorded: '2026-06-06' }, model.artifacts[0].sha256, true);
    expect((await modelCatalog(env)).models.find(item => item.family === model.family)!.creation).toMatchObject({
      date: null,
      status: 'unavailable',
    });
  });
});
