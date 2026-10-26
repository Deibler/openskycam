import { findNewestSegment } from '../db/StatusStorageOps';
import { STALE_AFTER_MS } from '../utils/configStorageUtil';
import { cameraIds } from './cameraStorageService';
import type { Env } from '../models/applicationSharedmodel';
import type { CameraStatus, StorageStatus } from '../models/statusStoragemodel';
/**
 * GET /v1/status
 *
 * How long ago each camera's newest segment was catalogued. Returns 503 if any camera is stale, so
 * an uptime monitor can alert on the status code alone.
 */
export async function getStatus(env: Env): Promise<StorageStatus> {
  const now = Date.now();
  const cameras = await Promise.all([...cameraIds(env)].map(cam => cameraStatus(env, cam, now)));
  const healthy = cameras.every(c => c.age_seconds !== null && c.age_seconds * 1000 <= STALE_AFTER_MS);
  return { healthy, cameras };
}

async function cameraStatus(env: Env, cam: string, now: number): Promise<CameraStatus> {
  const newest = await findNewestSegment(env.CATALOG, cam);
  return {
    cam,
    newest: newest?.object_key ?? null,
    age_seconds: newest ? Math.round((now - Date.parse(newest.uploaded_at)) / 1000) : null,
  };
}
