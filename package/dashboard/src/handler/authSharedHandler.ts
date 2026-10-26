import { authenticate } from '../service/accessSharedService';
import { authenticateApiKey, authenticateLink } from '../service/credentialSharedService';
import type { Env, Viewer } from '../models/applicationSharedmodel';
import type { ApiPrincipal } from '../models/credentialSharedmodel';
export function authenticateViewer(request: Request, env: Env): Promise<Viewer> {
  return authenticate(request.headers.get('Cf-Access-Jwt-Assertion'), new URL(request.url).hostname, env);
}
export async function authenticateMachine(request: Request, env: Env, ctx: ExecutionContext): Promise<ApiPrincipal> {
  const url = new URL(request.url);
  // A signed download link stands in for the bearer key on one GET path.
  const signed = !request.headers.has('Authorization') && url.searchParams.has('sig');
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  const authenticated = signed
    ? await authenticateLink(env, request.method, url.pathname, url.searchParams)
    : await authenticateApiKey(token, env);
  ctx.waitUntil(authenticated.recordUsage);
  return authenticated.principal;
}
