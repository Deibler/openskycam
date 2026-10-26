/** Website + machine API composition root. Business operations live in service/. */
import { ApplicationError } from '../../shared/src/utils/errorSharedUtil';
import { errorResponse, requireSameOrigin } from '../../shared/src/utils/httpSharedUtil';
import { match } from '../../shared/src/utils/routerSharedUtil';
import { authenticateViewer, authenticateMachine } from './handler/authSharedHandler';
import { websiteForKey } from './handler/apiSharedHandler';
import { isLocalDevelopment } from './utils/environmentSharedUtil';
import type { App, Env } from './models/applicationSharedmodel';
import openapi from '../openapi.json';
import { withKeyPaths } from './utils/openapiSharedUtil';
import { segmentsStorageRoutes } from './routes/segmentsStorageRoute';
import { calendarStorageRoutes } from './routes/calendarStorageRoute';
import { overviewStorageRoutes } from './routes/overviewStorageRoute';
import { videoStorageRoutes } from './routes/videoStorageRoute';
import { footageStorageRoutes } from './routes/footageStorageRoute';
import { processorInferenceRoutes } from './routes/processorInferenceRoute';
import { catalogInferenceRoutes } from './routes/catalogInferenceRoute';
import { modelInferenceRoutes, modelMachineInferenceRoutes } from './routes/modelInferenceRoute';
import { credentialSharedRoutes, identitySharedRoutes } from './routes/credentialSharedRoute';
import { workshopInferenceRoutes, workshopMachineInferenceRoutes } from './routes/workshopInferenceRoute';
import { agentSharedRoutes } from './routes/agentSharedRoute';
import { cleanupWorkshop } from './service/workshopInferenceService';
import { runSchedules } from './service/workshopScheduleInferenceService';
export { WorkshopRunSession } from './workshopRunSession';
const spec = withKeyPaths(openapi);
export const routes = [
  ...workshopInferenceRoutes,
  ...modelInferenceRoutes,
  ...credentialSharedRoutes,
  ...segmentsStorageRoutes,
  ...calendarStorageRoutes,
  ...overviewStorageRoutes,
  ...videoStorageRoutes,
  ...catalogInferenceRoutes,
];
export const machineRoutes = [
  ...agentSharedRoutes,
  ...workshopMachineInferenceRoutes,
  ...modelMachineInferenceRoutes,
  ...identitySharedRoutes,
  ...footageStorageRoutes,
  ...processorInferenceRoutes,
];
export default {
  async scheduled(event, env) {
    const at = new Date(event.scheduledTime);
    try {
      await runSchedules(env, at);
    } finally {
      if (at.getUTCMinutes() % 15 === 0) await cleanupWorkshop(env);
    }
  },
  async fetch(request, env, ctx): Promise<Response> {
    try {
      const url = new URL(request.url);
      const apiHost = url.hostname === env.API_HOST;
      const machinePath = url.pathname === '/v1' || url.pathname.startsWith('/v1/');
      if (url.pathname === '/openapi.json' && request.method === 'GET')
        return Response.json(spec, {
          headers: {
            'Cache-Control': 'public, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      if (machinePath) {
        const principal = await authenticateMachine(request, env, ctx);
        const found = match(machineRoutes, request);
        if (found) return await found.route.handler(request, { env, principal }, found.params, url, ctx);
        const website = await websiteForKey(request, env, principal, routes, ctx);
        if (!website) throw new ApplicationError('not_found', 'API endpoint not found.');
        return website;
      }
      // The machine hostname has no website or credential-management surface.
      if (apiHost) throw new ApplicationError('not_found', 'Use /v1 for API requests.');
      if (request.headers.has('Authorization'))
        throw new ApplicationError('forbidden', 'API keys are accepted only on /v1 endpoints.');
      const app: App = { env, viewer: await authenticateViewer(request, env) };
      if (url.pathname === '/docs') return Response.redirect(`${url.origin}/?view=api&tab=docs`, 302);

      const found = match(routes, request);
      if (found) {
        // A signed-in browser sends Access's cookie with any site's request; only this site may change data.
        if (request.method !== 'GET' && request.method !== 'HEAD') requireSameOrigin(request);
        return await found.route.handler(request, app, found.params, url, ctx);
      }
      if (url.pathname.startsWith('/api/')) {
        throw new ApplicationError('not_found', 'not found');
      }
      const asset = await env.ASSETS.fetch(request);
      return isLocalDevelopment(url.hostname, env) ? withoutContentSecurityPolicy(asset) : asset;
    } catch (error) {
      const response = errorResponse(error);
      response.headers.set('Cache-Control', 'no-store');
      if (response.status === 401) response.headers.set('WWW-Authenticate', 'Bearer realm="OpenSkyCam"');
      return response;
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * `wrangler dev --live-reload` injects an inline script into HTML, which the production policy in
 * ui/public/_headers (correctly) blocks. Locally only, drop the policy so live reload works.
 */
function withoutContentSecurityPolicy(response: Response): Response {
  const local = new Response(response.body, response);
  local.headers.delete('Content-Security-Policy');
  return local;
}
