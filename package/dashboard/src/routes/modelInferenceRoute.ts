import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App, MachineApp } from '../models/applicationSharedmodel';
import {
  catalogHandler,
  machineCatalogHandler,
  publishHandler,
  chunkHandler,
  artifactHandler,
  downloadHandler,
  devicesHandler,
  registerDeviceHandler,
  assignmentHandler,
  desiredHandler,
  reportHandler,
} from '../handler/modelInferenceHandler';
export const modelInferenceRoutes = [
  route<App>('GET', '/api/models', catalogHandler),
  route<App>('GET', '/api/models/devices', devicesHandler),
  route<App>('POST', '/api/models/devices', registerDeviceHandler),
  route<App>('PUT', '/api/models/devices/:id/deployment', assignmentHandler),
];
export const modelMachineInferenceRoutes = [
  route<MachineApp>('GET', '/v1/models', machineCatalogHandler),
  route<MachineApp>('POST', '/v1/models', publishHandler),
  route<MachineApp>('PUT', '/v1/models/chunks/:sha', chunkHandler),
  route<MachineApp>('POST', '/v1/models/artifacts', artifactHandler),
  route<MachineApp>('GET', '/v1/models/artifacts/:sha', downloadHandler),
  route<MachineApp>('GET', '/v1/models/devices/:id/desired', desiredHandler),
  route<MachineApp>('POST', '/v1/models/devices/:id/status', reportHandler),
];
