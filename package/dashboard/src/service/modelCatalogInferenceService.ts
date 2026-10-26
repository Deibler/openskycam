import type { Env } from '../models/applicationSharedmodel';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { ModelCatalog, ModelCreationMetadata, ModelVersion } from '../models/modelInferencemodel';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import { recordedModelDate } from '../utils/modelInferenceUtil';
import * as ops from '../db/ModelInferenceOps';

function record(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

async function importedCatalog(env: Env): Promise<Map<string, JsonObject> | null> {
  try {
    const pointerText = await ops.readRegistryText(env, 'registry/latest.json', 4096);
    const pointer = pointerText && record(JSON.parse(pointerText));
    if (
      !pointer ||
      pointer.schema_version !== 1 ||
      typeof pointer.catalog_key !== 'string' ||
      typeof pointer.catalog_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(pointer.catalog_sha256) ||
      !/^catalogs\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\/catalog\.json$/.test(pointer.catalog_key) ||
      !pointer.catalog_key.includes(`/${pointer.catalog_sha256}/`)
    )
      return null;
    const text = await ops.readRegistryText(env, pointer.catalog_key, 1024 * 1024);
    if (!text || (await sha256(text)) !== pointer.catalog_sha256) return null;
    const snapshot = record(JSON.parse(text));
    if (!snapshot || snapshot.schema_version !== 1 || !Array.isArray(snapshot.models) || snapshot.models.length > 1000)
      return null;
    const result = new Map<string, JsonObject>();
    for (const value of snapshot.models) {
      const model = record(value);
      if (model && typeof model.family === 'string' && typeof model.version === 'string')
        result.set(`${model.family}/${model.version}`, model);
    }
    return result;
  } catch {
    // The published catalog remains usable during an optional metadata outage.
    console.warn('Model creation-date metadata is unavailable.');
    return null;
  }
}

function creationMetadata(model: ModelVersion, imports: Map<string, JsonObject> | null): ModelCreationMetadata {
  const supplied = recordedModelDate(model.created_at);
  if (supplied) return { date: supplied, source: 'publisher', legacy_date: null, status: 'available' };
  const missing: ModelCreationMetadata = { date: null, source: null, legacy_date: null, status: 'not-recorded' };
  if (!model.source_manifest) return missing;
  const source = imports?.get(`${model.family}/${model.version}`);
  const artifacts = source?.artifacts;
  // Only attach historical dates to the imported identity and matching original weights.
  if (
    !source ||
    model.source_manifest !== `models/${model.family}/${model.version}/manifest.json` ||
    !Array.isArray(artifacts) ||
    !model.artifacts.some(artifact => artifacts.some(value => record(value)?.sha256 === artifact.sha256))
  ) {
    return { ...missing, status: 'unavailable' };
  }
  const training = record(source.training);
  const checkpoint = recordedModelDate(training?.checkpoint_date_as_recorded);
  const legacy = recordedModelDate(training?.legacy_manifest_trained_at);
  return {
    date: checkpoint ?? legacy,
    source: checkpoint ? 'checkpoint' : legacy ? 'legacy-manifest' : null,
    legacy_date: legacy,
    status: checkpoint || legacy ? 'available' : 'not-recorded',
  };
}

export async function modelCatalog(env: Env): Promise<ModelCatalog> {
  const rows = await ops.listModels(env);
  const versions = rows.map(row => JSON.parse(row.manifest_json) as ModelVersion);
  // One bounded snapshot read serves every imported model, rather than one request per version.
  const imports = versions.some(model => model.source_manifest) ? await importedCatalog(env) : null;
  return {
    models: versions.map((model, index) => ({
      ...model,
      registered_at: rows[index].created_at,
      creation: creationMetadata(model, imports),
    })),
  };
}
