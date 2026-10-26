/** Ingest composition root: authenticate, dispatch, and translate errors. */
import { errorResponse } from '../../shared/src/utils/httpSharedUtil';
import { dispatch } from '../../shared/src/utils/routerSharedUtil';
import { authenticate } from './handler/authSharedHandler';
import { segmentsStorageRoutes } from './routes/segmentsStorageRoute';
import { statusStorageRoutes } from './routes/statusStorageRoute';
import type { Env } from './models/applicationSharedmodel';
const routes = [...segmentsStorageRoutes, ...statusStorageRoutes];
export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      await authenticate(request, env);
      return await dispatch(routes, request, env, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
