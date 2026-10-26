import type { AccessKeySet } from '../models/accessSharedmodel';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { isLocalDevelopment } from '../utils/environmentSharedUtil';
import type { Env, Viewer } from '../models/applicationSharedmodel';
/**
 * Cloudflare Access sits in front of this Worker and signs every request it lets through
 * (Cf-Access-Jwt-Assertion). Verifying that token here means the Worker never trusts a request
 * that bypassed Access, e.g. through a misconfigured route.
 */
export async function authenticate(token: string | null, hostname: string, env: Env): Promise<Viewer> {
  if (isLocalDevelopment(hostname, env)) {
    return { email: env.DEV_VIEWER_EMAIL! };
  }

  if (!token) {
    throw new ApplicationError('forbidden', 'sign in through Cloudflare Access');
  }

  try {
    const { payload } = await jwtVerify(token, signingKeys(env.ACCESS_TEAM_DOMAIN), {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    return { email: typeof payload.email === 'string' ? payload.email : '' };
  } catch (error) {
    // Failing to fetch Access's public keys says nothing about the token; the viewer should retry.
    if (!(error instanceof errors.JOSEError) || error.code === 'ERR_JWKS_TIMEOUT' || error.code === 'ERR_JOSE_GENERIC')
      throw new ApplicationError('unavailable', 'Access keys are unavailable, retry shortly');
    throw new ApplicationError('forbidden', 'invalid or expired Access token');
  }
}
// One key set per team domain, reused across requests so the public keys are fetched rarely.
const keySets = new Map<string, AccessKeySet>();

function signingKeys(teamDomain: string): AccessKeySet {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
    keySets.set(teamDomain, keys);
  }
  return keys;
}
