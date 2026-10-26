import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App } from '../models/applicationSharedmodel';
import { reconcileHandler, statusHandler, resultHandler } from '../handler/catalogInferenceHandler';
export const catalogInferenceRoutes = [
  route<App>('POST', '/api/inference/reconcile', reconcileHandler),
  route<App>('GET', '/api/inference/status', statusHandler),
  route<App>('GET', '/api/inference/jobs/:id/result', resultHandler),
];
