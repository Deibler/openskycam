import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
export function cameraIds(env: Env): string[] {
  return env.CAMERAS.split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

export function requireKnownCamera(env: Env, cam: string | null): string {
  if (!cam || !cameraIds(env).includes(cam)) {
    throw new ApplicationError('invalid_input', `unknown camera: ${cam ?? '(none)'}`);
  }
  return cam;
}
