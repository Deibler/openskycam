import { privateJson, readBody } from '../../../shared/src/utils/httpSharedUtil';
import * as credentials from '../service/credentialSharedService';
import { isLocalHost } from '../utils/environmentSharedUtil';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App, MachineApp } from '../models/applicationSharedmodel';
export const listKeysHandler: Handler<App> = async (_request, app, _params, url) => {
  const local = isLocalHost(url.hostname);
  return privateJson({
    ...(await credentials.listKeys(app)),
    api_base_url: local ? url.origin : `https://${app.env.API_HOST}`,
    environment: local ? 'development' : 'production',
  });
};
export const createKeyHandler: Handler<App> = async (request, app) =>
  privateJson(await credentials.createKey(app, await readBody(request)), 201);
export const updateKeyHandler: Handler<App> = async (request, app, { id }) =>
  privateJson(await credentials.updateKey(app, id, await readBody(request)));
export const revokeKeyHandler: Handler<App> = async (request, app, { id }) =>
  privateJson(await credentials.revokeKey(app, id));
export const rotateKeyHandler: Handler<App> = async (request, app, { id }) =>
  privateJson(await credentials.rotateKey(app, id));
export const identityHandler: Handler<MachineApp> = async (_request, { principal }) =>
  privateJson({
    key_id: principal.id,
    scope: principal.scope,
    ...(principal.device_id ? { device_id: principal.device_id } : {}),
    cameras: principal.cameras,
    ...(principal.pipeline_id ? { pipeline_id: principal.pipeline_id } : {}),
  });
export const camerasHandler: Handler<MachineApp> = async (_request, { principal }) =>
  privateJson({ cameras: principal.cameras });
