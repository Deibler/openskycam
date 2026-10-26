import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
import { statusHandler } from '../handler/statusStorageHandler';
export const statusStorageRoutes = [route<Env>('GET', '/v1/status', statusHandler)];
