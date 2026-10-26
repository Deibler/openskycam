import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
import { uploadHandler } from '../handler/segmentsStorageHandler';
export const segmentsStorageRoutes = [route<Env>('PUT', '/v1/segments/:cam/:start', uploadHandler)];
