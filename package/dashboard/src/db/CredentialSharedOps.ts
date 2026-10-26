import type { Env } from '../models/applicationSharedmodel';
import type { KeyRow, NewCredentialRow, CredentialSecret } from '../models/credentialSharedmodel';
const keyStore = (env: Env) => env.API_KEYS.withSession('first-primary');
export async function listOwnedKeys(env: Env, owner: string, now: string): Promise<KeyRow[]> {
  const { results } = await keyStore(env)
    .prepare(
      'SELECT * FROM api_keys WHERE owner = ? ORDER BY (revoked_at IS NULL AND expires_at > ?) DESC, created_at DESC, id DESC LIMIT 200',
    )
    .bind(owner, now)
    .all<KeyRow>();
  return results;
}
export function createOwnedKey(env: Env, row: NewCredentialRow, maxKeys: number): Promise<KeyRow | null> {
  return keyStore(env)
    .prepare(
      `INSERT INTO api_keys (id, owner, name, secret_hash, prefix, cameras, created_at, expires_at, scope, pipeline_id, device_id)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM api_keys WHERE owner = ? AND revoked_at IS NULL AND expires_at > ?) < ? RETURNING *`,
    )
    .bind(
      row.id,
      row.owner,
      row.name,
      row.secret_hash,
      row.prefix,
      row.cameras,
      row.created_at,
      row.expires_at,
      row.scope,
      row.pipeline_id,
      row.device_id,
      row.owner,
      row.created_at,
      maxKeys,
    )
    .first<KeyRow>();
}
export function renameOwnedKey(env: Env, id: string, owner: string, name: string): Promise<KeyRow | null> {
  return keyStore(env)
    .prepare('UPDATE api_keys SET name = ? WHERE id = ? AND owner = ? AND revoked_at IS NULL RETURNING *')
    .bind(name, id, owner)
    .first<KeyRow>();
}
export function revokeOwnedKey(env: Env, id: string, owner: string, now: string): Promise<KeyRow | null> {
  return keyStore(env)
    .prepare('UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND owner = ? RETURNING *')
    .bind(now, id, owner)
    .first<KeyRow>();
}
export function rotateOwnedKey(
  env: Env,
  id: string,
  owner: string,
  secret: CredentialSecret,
  now: string,
): Promise<KeyRow | null> {
  return keyStore(env)
    .prepare(
      'UPDATE api_keys SET secret_hash = ?, prefix = ?, rotated_at = ?, last_used_at = NULL WHERE id = ? AND owner = ? AND revoked_at IS NULL AND expires_at > ? RETURNING *',
    )
    .bind(secret.hash, secret.prefix, now, id, owner, now)
    .first<KeyRow>();
}
export function findKey(env: Env, id: string): Promise<KeyRow | null> {
  return keyStore(env).prepare('SELECT * FROM api_keys WHERE id = ?').bind(id).first<KeyRow>();
}
export async function touchKey(env: Env, row: KeyRow, now: string, cutoff: string): Promise<void> {
  await keyStore(env)
    .prepare(
      'UPDATE api_keys SET last_used_at = ? WHERE id = ? AND secret_hash = ? AND (last_used_at IS NULL OR last_used_at < ?)',
    )
    .bind(now, row.id, row.secret_hash, cutoff)
    .run();
}
