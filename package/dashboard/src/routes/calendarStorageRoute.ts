import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App } from '../models/applicationSharedmodel';
import { calendarHandler } from '../handler/calendarStorageHandler';
export const calendarStorageRoutes = [route<App>('GET', '/api/availability', calendarHandler)];
