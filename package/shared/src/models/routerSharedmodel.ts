export type Params = Record<string, string>;

export type Handler<Env> = (
  request: Request,
  env: Env,
  params: Params,
  url: URL,
  ctx: ExecutionContext,
) => Promise<Response>;

export interface Route<Env> {
  method: string;
  pattern: URLPattern;
  handler: Handler<Env>;
}
export interface RouteMatch<Env> {
  route: Route<Env>;
  params: Params;
}
