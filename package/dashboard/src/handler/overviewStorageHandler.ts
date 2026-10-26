import { json } from '../../../shared/src/utils/httpSharedUtil';
import { getOverview } from '../service/overviewStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App } from '../models/applicationSharedmodel';
export const overviewHandler: Handler<App> = async (_request, app, _params, url) =>
  json(await getOverview(app, url.searchParams.get('cam')));
