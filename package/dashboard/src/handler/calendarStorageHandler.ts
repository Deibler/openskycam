import { json } from '../../../shared/src/utils/httpSharedUtil';
import { getAvailability } from '../service/calendarStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App } from '../models/applicationSharedmodel';
export const calendarHandler: Handler<App> = async (_request, app, _params, url) =>
  json(await getAvailability(app.env, url.searchParams.get('cam'), url.searchParams.get('boundaries')));
