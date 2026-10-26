import type { Env } from '../models/applicationSharedmodel';
import type {
  ArtifactChunk,
  ArtifactRow,
  ModelDeployment,
  ModelDevice,
  ModelRow,
  ModelVersion,
} from '../models/modelInferencemodel';
import { hex } from '../../../shared/src/utils/cryptoSharedUtil';
import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';

/** Bounded metadata reads. Model weights are never downloaded for catalog browsing. */
export async function readRegistryText(env: Env, key: string, maxBytes: number): Promise<string | null> {
  const object = await env.MODELS.get(key);
  if (!object) return null;
  if (object.size > maxBytes) {
    await object.body.cancel();
    throw new ApplicationError('invalid_data', 'Model catalog metadata exceeds its size limit.');
  }
  return object.text();
}

export async function listModels(env: Env): Promise<ModelRow[]> {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM model_versions ORDER BY family, version LIMIT 1000')
      .all<ModelRow>()
  ).results;
}
export function findModel(env: Env, family: string, version: string): Promise<ModelRow | null> {
  return env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM model_versions WHERE family = ? AND version = ?')
    .bind(family, version)
    .first<ModelRow>();
}
export async function insertModel(env: Env, m: ModelVersion, serialized: string, now: string): Promise<ModelRow> {
  const db = env.CATALOG.withSession('first-primary');
  await db
    .prepare('INSERT OR IGNORE INTO model_versions VALUES (?, ?, ?, ?)')
    .bind(m.family, m.version, serialized, now)
    .run();
  return (await db
    .prepare('SELECT * FROM model_versions WHERE family = ? AND version = ?')
    .bind(m.family, m.version)
    .first<ModelRow>())!;
}
export function findArtifact(env: Env, sha: string): Promise<ArtifactRow | null> {
  return env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM model_artifacts WHERE sha256 = ?')
    .bind(sha)
    .first<ArtifactRow>();
}
export async function insertArtifact(
  env: Env,
  sha: string,
  bytes: number,
  chunks: ArtifactChunk[],
  now: string,
): Promise<void> {
  await env.CATALOG.prepare('INSERT OR IGNORE INTO model_artifacts VALUES (?, ?, NULL, ?, ?)')
    .bind(sha, bytes, JSON.stringify(chunks), now)
    .run();
}
export async function putChunk(env: Env, sha: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  await env.MODELS.put(`chunks/sha256/${sha}`, bytes, {
    sha256: sha,
    onlyIf: { etagDoesNotMatch: '*' },
  });
}
export async function verifyChunks(env: Env, chunks: ArtifactChunk[]): Promise<string> {
  const digest = new crypto.DigestStream('SHA-256');
  // Observe rejection even if a missing chunk terminates the stream early.
  void digest.digest.catch(() => {});
  try {
    for (const chunk of chunks) {
      const object = await env.MODELS.get(`chunks/sha256/${chunk.sha256}`);
      if (!object || object.size !== chunk.bytes) {
        await object?.body.cancel();
        throw new ApplicationError(
          'invalid_data',
          'An upload chunk is missing or has the wrong size. Retry the upload.',
        );
      }
      await object.body.pipeTo(digest, { preventClose: true });
    }
    const writer = digest.getWriter();
    await writer.close();
    return hex(new Uint8Array(await digest.digest));
  } catch (error) {
    if (!digest.locked) await digest.abort(error).catch(() => {});
    throw error;
  }
}
export async function artifactStream(env: Env, row: ArtifactRow): Promise<ReadableStream<Uint8Array>> {
  if (row.object_key) {
    const object = await env.MODELS.get(row.object_key);
    if (!object || object.size !== row.bytes)
      throw new ApplicationError('unavailable', 'Model artifact is unavailable.');
    return object.body;
  }
  const chunks = JSON.parse(row.chunks_json!) as ArtifactChunk[];
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (index === chunks.length) {
              controller.close();
              return;
            }
            const chunk = chunks[index++];
            const object = await env.MODELS.get(`chunks/sha256/${chunk.sha256}`);
            if (!object || object.size !== chunk.bytes) throw new Error('Missing model chunk');
            reader = object.body.getReader();
          }
          const { value, done } = await reader.read();
          if (done) {
            reader.releaseLock();
            reader = undefined;
            continue;
          }
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
    },
  });
}
export async function listDevices(env: Env): Promise<ModelDevice[]> {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM model_devices ORDER BY id LIMIT 100')
      .all<ModelDevice>()
  ).results;
}
export function findDevice(env: Env, id: string): Promise<ModelDevice | null> {
  return env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM model_devices WHERE id = ?')
    .bind(id)
    .first<ModelDevice>();
}
export async function createDevice(env: Env, id: string, now: string): Promise<void> {
  await env.CATALOG.prepare('INSERT OR IGNORE INTO model_devices (id, updated_at) VALUES (?, ?)').bind(id, now).run();
}
export async function assignDevice(env: Env, deployment: ModelDeployment, previous: string | null): Promise<boolean> {
  const data = JSON.stringify(deployment);
  const db = env.CATALOG.withSession('first-primary');
  const results = await db.batch([
    db
      .prepare(
        'UPDATE model_devices SET revision = ?, deployment_json = ?, updated_at = ?, status = ?, error = NULL WHERE id = ? AND revision IS ?',
      )
      .bind(deployment.revision, data, deployment.created_at, 'pending', deployment.device_id, previous),
    db
      .prepare(
        'INSERT OR IGNORE INTO model_deployments SELECT revision, id, deployment_json, updated_at FROM model_devices WHERE id = ? AND revision = ?',
      )
      .bind(deployment.device_id, deployment.revision),
  ]);
  return results[0].meta.changes === 1;
}
export async function reportDevice(
  env: Env,
  id: string,
  revision: string | null,
  activeRevision: string | null,
  status: string,
  error: string | null,
  now: string,
): Promise<void> {
  await env.CATALOG.prepare(
    `UPDATE model_devices SET reported_revision = ?,
    status = CASE WHEN revision IS ? THEN ? ELSE 'pending' END, error = ?, last_seen_at = ? WHERE id = ?`,
  )
    .bind(activeRevision, revision, status, error, now, id)
    .run();
}
