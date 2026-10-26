import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
export function cameraIds(env: Env): Set<string> {
  return new Set(
    env.CAMERAS.split(',')
      .map(id => id.trim())
      .filter(Boolean),
  );
}

export function requireKnownCamera(env: Env, cam: string): void {
  if (!cameraIds(env).has(cam)) {
    throw new ApplicationError('invalid_input', `unknown camera: ${cam}`);
  }
}
