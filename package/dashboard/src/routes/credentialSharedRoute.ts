import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { App, MachineApp } from '../models/applicationSharedmodel';
import {
  listKeysHandler,
  createKeyHandler,
  updateKeyHandler,
  revokeKeyHandler,
  rotateKeyHandler,
  identityHandler,
  camerasHandler,
} from '../handler/credentialSharedHandler';
export const credentialSharedRoutes = [
  route<App>('GET', '/api/keys', listKeysHandler),
  route<App>('POST', '/api/keys', createKeyHandler),
  route<App>('PATCH', '/api/keys/:id', updateKeyHandler),
  route<App>('DELETE', '/api/keys/:id', revokeKeyHandler),
  route<App>('POST', '/api/keys/:id/rotate', rotateKeyHandler),
];
export const identitySharedRoutes = [
  route<MachineApp>('GET', '/v1/me', identityHandler),
  route<MachineApp>('GET', '/v1/cameras', camerasHandler),
];
