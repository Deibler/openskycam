import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App } from '../models/applicationSharedmodel';
import { overviewHandler } from '../handler/overviewStorageHandler';
export const overviewStorageRoutes = [route<App>('GET', '/api/overview', overviewHandler)];
