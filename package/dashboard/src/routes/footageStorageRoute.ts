import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { MachineApp } from '../models/applicationSharedmodel';
import { footageHandler } from '../handler/footageStorageHandler';
import { apiVideoHandler } from '../handler/videoStorageHandler';
export const footageStorageRoutes = [
  route<MachineApp>('GET', '/v1/recordings', footageHandler),
  route<MachineApp>('GET', '/v1/recordings/:camera/:start/file', apiVideoHandler),
  route<MachineApp>('HEAD', '/v1/recordings/:camera/:start/file', apiVideoHandler),
];
