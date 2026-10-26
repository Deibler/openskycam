import { ApplicationError } from './errorSharedUtil';
import type { Params, Handler, Route, RouteMatch } from '../models/routerSharedmodel';
export function route<Env>(method: string, pathname: string, handler: Handler<Env>): Route<Env> {
  return { method, pattern: new URLPattern({ pathname }), handler };
}

/** Finds the route for a request, or null if no route's path matches. 405 if only the method is wrong. */
export function match<Env>(routes: Route<Env>[], request: Request): RouteMatch<Env> | null {
  const url = request.url;
  const matching = routes.filter(r => r.pattern.test(url));
  if (matching.length === 0) {
    return null;
  }

  const found = matching.find(r => r.method === request.method);
  if (!found) {
    throw new ApplicationError('method_not_allowed', 'method not allowed');
  }

  const params = (found.pattern.exec(url)?.pathname.groups ?? {}) as Params;
  return { route: found, params };
}

/** Runs the handler for the matching route. 404 for unknown paths, 405 for wrong methods. */
export function dispatch<Env>(
  routes: Route<Env>[],
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const found = match(routes, request);
  if (!found) {
    throw new ApplicationError('not_found', 'not found');
  }
  return found.route.handler(request, env, found.params, new URL(request.url), ctx);
}
