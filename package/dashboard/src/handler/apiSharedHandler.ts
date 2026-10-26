import type { Route } from '../../../shared/src/models/routerSharedmodel';
import { match } from '../../../shared/src/utils/routerSharedUtil';
import { requireFullAccess } from '../service/credentialSharedService';
import type { App, Env } from '../models/applicationSharedmodel';
import type { ApiPrincipal } from '../models/credentialSharedmodel';

/**
 * Everything the website does, for API keys: /v1/<path> runs the website's /api/<path> with an Agent
 * key for every camera, and the answer's *_url links point at /v1 too. API keys themselves are
 * managed only on the website, so a leaked key cannot make more. Null when no website route matches.
 */
export async function websiteForKey(
  request: Request,
  env: Env,
  principal: ApiPrincipal,
  routes: Route<App>[],
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  url.pathname = `/api${url.pathname.slice('/v1'.length)}`;
  if (url.pathname === '/api/keys' || url.pathname.startsWith('/api/keys/')) return null;
  const website = new Request(url, request);
  const found = match(routes, website);
  if (!found) return null;
  requireFullAccess(env, principal);
  const response = await found.route.handler(website, { env, viewer: { email: '' } }, found.params, url, ctx);
  if (!response.headers.get('Content-Type')?.startsWith('application/json')) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(JSON.stringify(machineLinks(await response.json())), { status: response.status, headers });
}

/** The website's /api/... links in *_url fields, as the /v1/... paths a key can follow. */
function machineLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(machineLinks);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      key.endsWith('_url') && typeof v === 'string' && v.startsWith('/api/') ? `/v1/${v.slice(5)}` : machineLinks(v),
    ]),
  );
}
