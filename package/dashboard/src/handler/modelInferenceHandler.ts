import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App, MachineApp } from '../models/applicationSharedmodel';
import { privateJson, readBody, readBytes } from '../../../shared/src/utils/httpSharedUtil';
import * as models from '../service/modelInferenceService';
import { modelCatalog } from '../service/modelCatalogInferenceService';

export const catalogHandler: Handler<App> = async (_request, app) => privateJson(await modelCatalog(app.env));
export const machineCatalogHandler: Handler<MachineApp> = async (_request, app) => {
  models.requireCatalogReader(app.principal);
  return privateJson(await modelCatalog(app.env));
};
export const publishHandler: Handler<MachineApp> = async (request, app) =>
  privateJson(await models.publishModel(app.env, app.principal, await readBody(request, 65536)), 201);
export const chunkHandler: Handler<MachineApp> = async (request, app, { sha }) => {
  models.requirePublisher(app.principal);
  return privateJson(
    await models.publishChunk(
      app.env,
      app.principal,
      sha,
      await readBytes(request, 8 * 1024 * 1024, 'A chunk body is required.', 'Upload chunks must be at most 8 MiB.'),
    ),
  );
};
export const artifactHandler: Handler<MachineApp> = async (request, app) =>
  privateJson(await models.finishArtifact(app.env, app.principal, await readBody(request, 32768)));
export const downloadHandler: Handler<MachineApp> = async (_request, app, { sha }) => {
  const artifact = await models.downloadArtifact(app.env, app.principal, sha);
  return new Response(artifact.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(artifact.bytes),
      'X-Content-SHA256': artifact.sha256,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
export const devicesHandler: Handler<App> = async (_request, app) => privateJson(await models.devices(app.env));
export const registerDeviceHandler: Handler<App> = async (request, app) =>
  privateJson(await models.registerDevice(app.env, await readBody(request)), 201);
export const assignmentHandler: Handler<App> = async (request, app, { id }) =>
  privateJson(await models.assign(app.env, id, await readBody(request, 32768)));
export const desiredHandler: Handler<MachineApp> = async (_request, app, { id }) =>
  privateJson(await models.desired(app.env, app.principal, id));
export const reportHandler: Handler<MachineApp> = async (request, app, { id }) =>
  privateJson(await models.report(app.env, app.principal, id, await readBody(request)));
