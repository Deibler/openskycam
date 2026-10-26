import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App } from '../models/applicationSharedmodel';
import { listSegmentsHandler } from '../handler/segmentsStorageHandler';
export const segmentsStorageRoutes = [route<App>('GET', '/api/segments', listSegmentsHandler)];
