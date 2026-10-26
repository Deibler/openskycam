import { json } from '../../../shared/src/utils/httpSharedUtil';
import { listSegments } from '../service/segmentsStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App } from '../models/applicationSharedmodel';
export const listSegmentsHandler: Handler<App> = async (_request, app, _params, url) =>
  json(
    await listSegments(app.env, {
      camera: url.searchParams.get('cam'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    }),
  );
