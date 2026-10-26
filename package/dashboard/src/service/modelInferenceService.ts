import type { Env } from '../models/applicationSharedmodel';
import type { ApiPrincipal } from '../models/credentialSharedmodel';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type {
  ArtifactChunk,
  ArtifactDownload,
  ModelArtifact,
  ModelClass,
  ModelDeployment,
  ModelParameters,
  ModelVersion,
} from '../models/modelInferencemodel';
import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import { canonicalModel, recordedModelDate } from '../utils/modelInferenceUtil';
import * as ops from '../db/ModelInferenceOps';

const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
function invalid(message: string): never {
  throw new ApplicationError('invalid_input', message);
}
export function modelSlug(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value))
    invalid('Use 1–64 lowercase letters, numbers, dots, underscores or hyphens for IDs.');
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('A SHA-256 digest is required.');
  return value;
}
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object.');
  return value as JsonObject;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    invalid(`Provide text between 1 and ${max} characters.`);
  return value;
}
function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) invalid('Invalid list.');
  return value.map(item => text(item, 2000));
}
function size(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
    invalid(`Size must be between 1 and ${max} bytes.`);
  return Number(value);
}
/** Publishers read the catalog to publish; agent keys read it like the website's Models page. */
export function requireCatalogReader(principal: ApiPrincipal): void {
  if (principal.scope !== 'models:write' && principal.scope !== 'agent')
    throw new ApplicationError('forbidden', 'Use a model publishing or Agent key.');
}
export function requirePublisher(principal: ApiPrincipal): void {
  if (principal.scope !== 'models:write') throw new ApplicationError('forbidden', 'Use a model publishing key.');
}
function requireDevice(principal: ApiPrincipal, id: string): void {
  if (principal.scope !== 'models:sync' || principal.device_id !== id)
    throw new ApplicationError('forbidden', 'This key cannot manage that device.');
}
export async function publishChunk(
  env: Env,
  principal: ApiPrincipal,
  sha: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ sha256: string; bytes: number }> {
  requirePublisher(principal);
  digest(sha);
  size(bytes.byteLength, CHUNK_BYTES);
  if ((await sha256(bytes.buffer)) !== sha) throw new ApplicationError('invalid_data', 'Chunk checksum mismatch.');
  await ops.putChunk(env, sha, bytes);
  return { sha256: sha, bytes: bytes.length };
}
export async function finishArtifact(
  env: Env,
  principal: ApiPrincipal,
  body: JsonObject,
): Promise<{ sha256: string; bytes: number }> {
  requirePublisher(principal);
  const sha = digest(body.sha256);
  const bytes = size(body.bytes, MAX_ARTIFACT_BYTES);
  const existing = await ops.findArtifact(env, sha);
  if (existing) {
    if (existing.bytes !== bytes) throw new ApplicationError('conflict', 'Artifact size conflicts with its checksum.');
    return { sha256: sha, bytes };
  }
  if (!Array.isArray(body.chunks) || !body.chunks.length || body.chunks.length > 128)
    invalid('Supply up to 128 ordered upload chunks.');
  const chunks: ArtifactChunk[] = body.chunks.map(value => {
    const c = object(value);
    return { sha256: digest(c.sha256), bytes: size(c.bytes, CHUNK_BYTES) };
  });
  if (chunks.reduce((sum, c) => sum + c.bytes, 0) !== bytes) invalid('Chunk sizes do not match the artifact size.');
  if ((await ops.verifyChunks(env, chunks)) !== sha)
    throw new ApplicationError('invalid_data', 'Full artifact checksum mismatch.');
  await ops.insertArtifact(env, sha, bytes, chunks, new Date().toISOString());
  return { sha256: sha, bytes };
}
export async function publishModel(env: Env, principal: ApiPrincipal, body: JsonObject): Promise<ModelVersion> {
  requirePublisher(principal);
  const family = modelSlug(body.family);
  const version = modelSlug(body.version);
  const task = body.task;
  if (
    task !== 'object-detection' &&
    task !== 'image-classification' &&
    task !== 'feature-classification' &&
    task !== 'image-encoder'
  )
    invalid('Choose a detection, classification or image encoder task.');
  const adapter = body.adapter;
  if (adapter !== 'ultralytics' && adapter !== 'unsupported') invalid('Unknown runtime adapter.');
  if (adapter === 'ultralytics' && !['object-detection', 'image-classification'].includes(task))
    invalid('This task needs a different runtime adapter.');
  if (!Array.isArray(body.classes) || body.classes.length > 1000) invalid('Provide the ordered class map.');
  const classes: ModelClass[] = body.classes.map((value, index) => {
    const c = object(value);
    if (c.id !== index) invalid('Class IDs must be ordered from zero without gaps.');
    return { id: index, name: text(c.name, 120) };
  });
  if (adapter === 'ultralytics' && !classes.length) invalid('Runnable models need verified class IDs.');
  if (!Array.isArray(body.artifacts) || !body.artifacts.length || body.artifacts.length > 16)
    invalid('Supply 1–16 uploaded artifacts.');
  const artifacts: ModelArtifact[] = [];
  for (const value of body.artifacts) {
    const a = object(value);
    const sha = digest(a.sha256);
    const bytes = size(a.bytes, MAX_ARTIFACT_BYTES);
    const stored = await ops.findArtifact(env, sha);
    if (!stored || stored.bytes !== bytes) invalid('Upload and verify each artifact before publishing its model.');
    const filename = text(a.filename, 120);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) invalid('Use a plain artifact filename without a path.');
    artifacts.push({
      sha256: sha,
      bytes,
      filename,
      format: text(a.format, 80),
    });
  }
  if (!Array.isArray(body.evaluations) || body.evaluations.length > 50)
    invalid('Provide evaluations, or an empty list when no metrics exist.');
  const dependencies = strings(body.dependencies ?? [], 16);
  for (const dep of dependencies) {
    const [f, v, extra] = dep.split('/');
    if (extra || !v || !(await ops.findModel(env, modelSlug(f), modelSlug(v))))
      invalid('Dependencies must name existing immutable model versions.');
  }
  const model: ModelVersion = {
    family,
    version,
    task,
    adapter,
    classes,
    artifacts,
    name: text(body.name, 120),
    description: text(body.description, 4000),
    input: object(body.input),
    evaluations: body.evaluations.map(value => object(value)),
    caveats: strings(body.caveats ?? [], 50),
    dependencies,
  };
  if (body.created_at !== undefined) {
    const date = recordedModelDate(body.created_at);
    if (!date || !/(?:Z|[+-]\d{2}:\d{2})$/.test(date))
      invalid('created_at must be an ISO 8601 timestamp with a timezone.');
    model.created_at = date;
  }
  const serialized = canonicalModel(model);
  const stored = await ops.insertModel(env, model, serialized, new Date().toISOString());
  if (canonicalModel(JSON.parse(stored.manifest_json)) !== serialized)
    throw new ApplicationError(
      'conflict',
      'This model version already exists. Publish a new version to change weights or metadata.',
    );
  return model;
}
export async function downloadArtifact(env: Env, principal: ApiPrincipal, sha: string): Promise<ArtifactDownload> {
  digest(sha);
  if (principal.scope === 'models:sync' && principal.device_id) {
    const device = await ops.findDevice(env, principal.device_id);
    const assignment = device?.deployment_json ? (JSON.parse(device.deployment_json) as ModelDeployment) : null;
    if (!assignment?.models.some(m => m.artifact.sha256 === sha))
      throw new ApplicationError('forbidden', 'This artifact is not assigned to your device.');
  } else requirePublisher(principal);
  const artifact = await ops.findArtifact(env, sha);
  if (!artifact) throw new ApplicationError('not_found', 'Artifact not found.');
  return {
    body: await ops.artifactStream(env, artifact),
    bytes: artifact.bytes,
    sha256: sha,
  };
}
export async function devices(env: Env) {
  return {
    devices: (await ops.listDevices(env)).map(({ deployment_json, ...row }) => ({
      ...row,
      deployment: deployment_json ? (JSON.parse(deployment_json) as ModelDeployment) : null,
    })),
  };
}
export async function registerDevice(env: Env, body: JsonObject): Promise<{ id: string }> {
  const id = modelSlug(body.id);
  await ops.createDevice(env, id, new Date().toISOString());
  return { id };
}
function parameters(value: unknown): ModelParameters {
  const p = object(value);
  if (Object.keys(p).some(k => !['imgsz', 'confidence', 'iou', 'device'].includes(k)))
    invalid('Unknown inference parameter.');
  if (!Number.isInteger(p.imgsz) || Number(p.imgsz) < 32 || Number(p.imgsz) > 2048 || Number(p.imgsz) % 32)
    invalid('Input size must be a multiple of 32 between 32 and 2048.');
  for (const key of ['confidence', 'iou'])
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || Number(p[key]) < 0 || Number(p[key]) > 1)
      invalid(`${key} must be between zero and one.`);
  if (p.device !== 'auto' && p.device !== 'cpu' && p.device !== 'mps' && p.device !== 'cuda')
    invalid('Choose auto, cpu, mps or cuda.');
  return {
    imgsz: Number(p.imgsz),
    confidence: Number(p.confidence),
    iou: Number(p.iou),
    device: p.device,
  };
}
export async function assign(env: Env, id: string, body: JsonObject): Promise<ModelDeployment> {
  modelSlug(id);
  const device = await ops.findDevice(env, id);
  if (!device) throw new ApplicationError('not_found', 'Register the device first.');
  if (body.previous_revision !== device.revision)
    throw new ApplicationError('conflict', 'The deployment changed. Refresh before deploying.');
  if (!Array.isArray(body.models) || body.models.length > 16)
    invalid('Choose up to 16 required models. An empty list unloads all managed models.');
  const deployment: ModelDeployment = {
    schema_version: 1,
    device_id: id,
    revision: crypto.randomUUID(),
    models: [],
    created_at: new Date().toISOString(),
  };
  for (const value of body.models) {
    const binding = object(value);
    const slot = modelSlug(binding.slot);
    if (deployment.models.some(m => m.slot === slot)) invalid('Each model needs a distinct slot.');
    const row = await ops.findModel(env, modelSlug(binding.family), modelSlug(binding.version));
    if (!row) invalid('Model version not found.');
    const model = JSON.parse(row.manifest_json) as ModelVersion;
    if (model.adapter !== 'ultralytics') invalid(`${model.name} needs a runtime adapter before deployment.`);
    const artifact = model.artifacts.find(a => a.sha256 === binding.sha256);
    if (!artifact || !artifact.filename.endsWith('.pt'))
      invalid('Choose a supported PyTorch checkpoint from this version.');
    deployment.models.push({
      slot,
      model,
      artifact,
      parameters: parameters(binding.parameters),
    });
  }
  const selected = new Set(deployment.models.map(m => `${m.model.family}/${m.model.version}`));
  for (const m of deployment.models)
    if (m.model.dependencies.some(d => !selected.has(d))) invalid('Include all model dependencies in this deployment.');
  if (!(await ops.assignDevice(env, deployment, device.revision)))
    throw new ApplicationError('conflict', 'The deployment changed. Refresh before deploying.');
  return deployment;
}
export async function desired(
  env: Env,
  principal: ApiPrincipal,
  id: string,
): Promise<{ deployment: ModelDeployment | null }> {
  requireDevice(principal, id);
  const device = await ops.findDevice(env, id);
  if (!device) throw new ApplicationError('not_found', 'Device not found.');
  return {
    deployment: device.deployment_json ? (JSON.parse(device.deployment_json) as ModelDeployment) : null,
  };
}
export async function report(env: Env, principal: ApiPrincipal, id: string, body: JsonObject): Promise<{ ok: true }> {
  requireDevice(principal, id);
  if (body.revision !== null && (typeof body.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(body.revision)))
    invalid('Invalid deployment revision.');
  if (body.status !== 'ready' && body.status !== 'error') invalid('Unknown device status.');
  if (
    body.active_revision !== null &&
    (typeof body.active_revision !== 'string' || !/^[a-f0-9-]{36}$/.test(body.active_revision))
  )
    invalid('Invalid active revision.');
  if (body.status === 'ready' && body.revision !== body.active_revision)
    invalid('A ready device must acknowledge its active revision.');
  // Clients send stable codes, never stack traces containing paths or credentials.
  const error = body.status === 'error' ? modelSlug(body.error) : null;
  await ops.reportDevice(
    env,
    id,
    body.revision as string | null,
    body.active_revision as string | null,
    body.status,
    error,
    new Date().toISOString(),
  );
  return { ok: true };
}
