import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256, hex, hmac } from '../../../shared/src/utils/cryptoSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import { cameraIds } from './cameraStorageService';
import { newSecret } from '../utils/credentialSharedUtil';
import * as ops from '../db/CredentialSharedOps';
import { findPipeline, listPipelineIds } from '../db/PipelineInferenceOps';
import type { App, Env } from '../models/applicationSharedmodel';
import type {
  KeyRow,
  ApiPrincipal,
  CredentialDescription,
  CredentialList,
  CredentialResult,
  IssuedCredential,
  AuthenticatedCredential,
} from '../models/credentialSharedmodel';
import { listDevices, findDevice } from '../db/ModelInferenceOps';
import { modelSlug } from './modelInferenceService';
const MAX_KEYS = 20;

const KEY_PATTERN = /^svk_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/;

function describe(row: KeyRow): CredentialDescription {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    cameras: JSON.parse(row.cameras) as string[],
    scope: row.scope,
    device_id: row.device_id,
    ...(row.pipeline_id ? { pipeline_id: row.pipeline_id } : {}),
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    rotated_at: row.rotated_at,
    revoked_at: row.revoked_at,
  };
}

function owner(app: App): string {
  if (!app.viewer.email.trim()) throw new ApplicationError('forbidden', 'Sign in with your email to manage API keys.');
  return app.viewer.email.trim().toLowerCase();
}

function readName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f]/.test(value))
    throw new ApplicationError('invalid_input', 'Name must contain 1 to 80 characters.');
  return value.trim();
}

export async function listKeys(app: App): Promise<CredentialList> {
  const results = await ops.listOwnedKeys(app.env, owner(app), new Date().toISOString());
  const pipelines = app.env.INFERENCE_ENABLED === 'true' ? await listPipelineIds(app.env.CATALOG) : [];
  return {
    pipelines,
    devices: (await listDevices(app.env)).map(device => device.id),
    keys: results.map(describe),
    cameras: cameraIds(app.env),
    max_active_keys: MAX_KEYS,
  };
}

export async function createKey(app: App, body: JsonObject): Promise<IssuedCredential> {
  const email = owner(app);
  const name = readName(body.name);
  const known = cameraIds(app.env);
  const scope = body.scope ?? 'footage:read';
  const modelKey = scope === 'models:write' || scope === 'models:sync';
  if (
    !Array.isArray(body.cameras) ||
    (!modelKey && !body.cameras.length) ||
    (modelKey && body.cameras.length !== 0) ||
    body.cameras.length > known.length ||
    body.cameras.some(c => typeof c !== 'string' || !known.includes(c))
  )
    throw new ApplicationError(
      'invalid_input',
      modelKey ? 'Model keys cannot include camera access.' : 'Choose at least one available camera.',
    );
  if (!Number.isInteger(body.expires_in_days) || Number(body.expires_in_days) < 1 || Number(body.expires_in_days) > 365)
    throw new ApplicationError('invalid_input', 'Expiry must be between 1 and 365 days.');
  const cameras = [...new Set(body.cameras)];
  if (
    scope !== 'footage:read' &&
    scope !== 'processor:run' &&
    scope !== 'models:write' &&
    scope !== 'models:sync' &&
    scope !== 'workshop:run' &&
    scope !== 'agent'
  )
    throw new ApplicationError('invalid_input', 'Unknown key scope.');
  let pipeline: string | null = null;
  if (scope === 'processor:run') {
    if (app.env.INFERENCE_ENABLED !== 'true')
      throw new ApplicationError('forbidden', 'Inference is not enabled in this environment.');
    if (typeof body.pipeline_id !== 'string' || !(await findPipeline(app.env.CATALOG, body.pipeline_id)))
      throw new ApplicationError('invalid_input', 'Choose a registered pipeline.');
    pipeline = body.pipeline_id;
  } else if (body.pipeline_id !== undefined)
    throw new ApplicationError('invalid_input', 'Read-only keys do not have a pipeline.');
  let device: string | null = null;
  if (scope === 'models:sync' || scope === 'workshop:run') {
    device = modelSlug(body.device_id);
    if (!(await findDevice(app.env, device)))
      throw new ApplicationError('invalid_input', 'Register the device in Models first.');
  } else if (body.device_id !== undefined)
    throw new ApplicationError('invalid_input', 'Only model sync and Workshop keys have a device.');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + Number(body.expires_in_days) * 86400000).toISOString();
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  const secret = await newSecret(id);
  const row = await ops.createOwnedKey(
    app.env,
    {
      id,
      owner: email,
      name,
      secret_hash: secret.hash,
      prefix: secret.prefix,
      cameras: JSON.stringify(cameras),
      created_at: now,
      expires_at: expires,
      scope,
      pipeline_id: pipeline,
      device_id: device,
    },
    MAX_KEYS,
  );
  if (!row) throw new ApplicationError('conflict', `You can have up to ${MAX_KEYS} active keys. Revoke one first.`);
  return { key: describe(row), token: secret.token };
}
export async function updateKey(app: App, id: string, body: JsonObject): Promise<CredentialResult> {
  const row = await ops.renameOwnedKey(app.env, id, owner(app), readName(body.name));
  if (!row) throw new ApplicationError('not_found', 'API key not found.');
  return { key: describe(row) };
}
export async function revokeKey(app: App, id: string): Promise<CredentialResult> {
  const row = await ops.revokeOwnedKey(app.env, id, owner(app), new Date().toISOString());
  if (!row) throw new ApplicationError('not_found', 'API key not found.');
  return { key: describe(row) };
}
export async function rotateKey(app: App, id: string): Promise<IssuedCredential> {
  const email = owner(app);
  const secret = await newSecret(id);
  const row = await ops.rotateOwnedKey(app.env, id, email, secret, new Date().toISOString());
  if (!row) throw new ApplicationError('not_found', 'Active API key not found.');
  return { key: describe(row), token: secret.token };
}

/** API keys authenticate only the machine API. They can never manage keys or sign in to the UI. */
export async function authenticateApiKey(token: string, env: Env): Promise<AuthenticatedCredential> {
  const match = KEY_PATTERN.exec(token);
  if (!match) throw new ApplicationError('unauthenticated', 'A valid API key is required.');
  const row = await ops.findKey(env, match[1]);
  const supplied = new TextEncoder().encode(await sha256(token));
  const expected = new TextEncoder().encode(row?.secret_hash ?? '0'.repeat(64));
  const valid = expected.length === supplied.length && crypto.subtle.timingSafeEqual(supplied, expected);
  const now = new Date().toISOString();
  if (!row || !valid || row.revoked_at || row.expires_at <= now)
    throw new ApplicationError('unauthenticated', 'A valid API key is required.');
  return { recordUsage: touch(env, row, now), principal: principalOf(env, row) };
}
function touch(env: Env, row: KeyRow, now: string) {
  const cutoff = new Date(Date.now() - 300000).toISOString();
  return !row.last_used_at || row.last_used_at < cutoff
    ? ops.touchKey(env, row, now, cutoff).catch(() => {
        console.warn('API key last-used update failed.');
      })
    : Promise.resolve();
}
function principalOf(env: Env, row: KeyRow): ApiPrincipal {
  return {
    id: row.id,
    scope: row.scope,
    device_id: row.device_id,
    pipeline_id: row.pipeline_id,
    cameras: (JSON.parse(row.cameras) as string[]).filter(cam => cameraIds(env).includes(cam)),
  };
}

// ponytail: fixed link lifetime; long enough to start a large download, short enough to leak little.
const LINK_SECONDS = 3600;
/**
 * A download link for one GET path, usable without the bearer key, e.g. by curl.
 * Signed with the key's own secret hash, so revoking or rotating the key ends every link it made.
 */
export async function signLinks(env: Env, principal: ApiPrincipal, paths: string[]) {
  const row = await ops.findKey(env, principal.id);
  if (!row) throw new ApplicationError('unauthenticated', 'A valid API key is required.');
  const expires = Math.floor(Math.min(Date.now() / 1000 + LINK_SECONDS, Date.parse(row.expires_at) / 1000));
  return Promise.all(
    paths.map(async path => ({
      url: `https://${env.API_HOST}${path}?key=${row.id}&expires=${expires}&sig=${await hmac(row.secret_hash, `${path}\n${expires}`)}`,
      expires_at: new Date(expires * 1000).toISOString(),
    })),
  );
}
export async function authenticateLink(
  env: Env,
  method: string,
  path: string,
  params: URLSearchParams,
): Promise<AuthenticatedCredential> {
  const [id, expires, sig] = ['key', 'expires', 'sig'].map(name => params.get(name) ?? '');
  const fail = () => {
    throw new ApplicationError('unauthenticated', 'This download link is invalid or has expired.');
  };
  if (
    (method !== 'GET' && method !== 'HEAD') ||
    [...params.keys()].length !== 3 ||
    !/^[a-f0-9]{32}$/.test(id) ||
    !/^\d{1,12}$/.test(expires) ||
    Number(expires) * 1000 <= Date.now()
  )
    fail();
  const row = await ops.findKey(env, id);
  const now = new Date().toISOString();
  const expected = new TextEncoder().encode(await hmac(row?.secret_hash ?? '0'.repeat(64), `${path}\n${expires}`));
  const supplied = new TextEncoder().encode(sig);
  if (
    !row ||
    row.revoked_at ||
    row.expires_at <= now ||
    expected.length !== supplied.length ||
    !crypto.subtle.timingSafeEqual(expected, supplied)
  )
    fail();
  return { recordUsage: touch(env, row!, now), principal: principalOf(env, row!) };
}
/**
 * Full access: an agent key for every camera may call everything the website does through /v1.
 * Workshop data is not split by camera, so a key for only some cameras keeps to MCP and footage.
 */
export function requireFullAccess(env: Env, principal: ApiPrincipal): void {
  if (principal.scope !== 'agent' || cameraIds(env).some(camera => !principal.cameras.includes(camera)))
    throw new ApplicationError('forbidden', 'This endpoint needs an Agent key for every camera.');
}
export function requireApiCamera(principal: ApiPrincipal, camera: string | null): string {
  if (!camera || !principal.cameras.includes(camera))
    throw new ApplicationError('forbidden', 'This key cannot access that camera.');
  return camera;
}
