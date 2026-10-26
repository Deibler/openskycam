import { privateJson, readBody } from '../../../shared/src/utils/httpSharedUtil';
import { reconcile, status } from '../service/catalogInferenceService';
import { readResult } from '../service/resultInferenceService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App } from '../models/applicationSharedmodel';
export const reconcileHandler: Handler<App> = async (request, app) =>
  privateJson(await reconcile(app.env, await readBody(request)));
export const statusHandler: Handler<App> = async (_request, app) => privateJson(await status(app.env));
export const resultHandler: Handler<App> = async (_request, app, { id }) =>
  new Response(await readResult(app.env, id), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
