import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
const encoder = new TextEncoder();

/**
 * Checks the request's bearer token against the configured secret in constant time.
 * Both values are hashed first, so the comparison is fixed-length and leaks nothing about length.
 */
export async function isAuthorized(header: string, secret: string | undefined): Promise<boolean> {
  if (!secret || !header.startsWith('Bearer ')) {
    return false;
  }
  const [given, expected] = await Promise.all([sha256(header.slice('Bearer '.length)), sha256(secret)]);
  return crypto.subtle.timingSafeEqual(given, expected);
}

function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

export async function authenticateToken(header: string, secret: string | undefined): Promise<void> {
  if (!(await isAuthorized(header, secret))) throw new ApplicationError('unauthenticated', 'unauthorized');
}
