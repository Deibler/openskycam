import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App } from '../models/applicationSharedmodel';
import { videoHandler } from '../handler/videoStorageHandler';
export const videoStorageRoutes = [route<App>('GET', '/api/video/:cam/:start', videoHandler)];
