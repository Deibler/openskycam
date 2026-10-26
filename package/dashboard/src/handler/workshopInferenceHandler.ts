import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App, MachineApp } from '../models/applicationSharedmodel';
import { privateJson, readBody, readBytes } from '../../../shared/src/utils/httpSharedUtil';
import * as workshop from '../service/workshopInferenceService';
import * as run from '../service/workshopRunInferenceService';
import * as processor from '../service/workshopProcessorInferenceService';
import * as deletion from '../service/workshopDeletionInferenceService';
import * as schedule from '../service/workshopScheduleInferenceService';
import * as review from '../service/workshopReviewInferenceService';
const lease = (request: Request) => ({
  generation: request.headers.get('X-Lease-Generation'),
  lease_token: request.headers.get('X-Lease-Token'),
});
export const loadHandler: Handler<App> = async (_r, a) => privateJson(await workshop.loadWorkshop(a.env));
export const saveHandler: Handler<App> = async (r, a) =>
  privateJson(await workshop.saveWorkshop(a.env, await readBody(r, 800000)));
export const schedulesHandler: Handler<App> = async (_r, a) => privateJson(await schedule.scheduleOutcomes(a.env));
export const runtimesHandler: Handler<App> = async (_r, a) => privateJson(await workshop.runtimeStatus(a.env));
export const registerHandler: Handler<App> = async (r, a) =>
  privateJson(await workshop.registerRuntime(a.env, await readBody(r)), 201);
export const runsHandler: Handler<App> = async (r, a) =>
  privateJson({ runs: await workshop.listRuns(a.env, new URL(r.url).searchParams.get('workflow')) });
export const summaryHandler: Handler<App> = async (_r, a) => privateJson(await review.workshopSummary(a.env));
export const runReviewHandler: Handler<App> = async (_r, a, { id }) => privateJson(await review.runReview(a.env, id));
export const runHandler: Handler<App> = async (r, a) =>
  privateJson(await workshop.createRun(a.env, await readBody(r)), 201);
export const cancelHandler: Handler<App> = async (r, a, { id }) => privateJson(await workshop.cancelRun(a.env, id));
export const bucketHandler: Handler<App> = async (_r, a, { id }) =>
  privateJson(await workshop.bucketContents(a.env, id));
export const workflowDeletionHandler: Handler<App> = async (_r, a, { id }) =>
  privateJson(await deletion.previewDeletion(a.env, 'workflow', id));
export const bucketDeletionHandler: Handler<App> = async (_r, a, { id }) =>
  privateJson(await deletion.previewDeletion(a.env, 'bucket', id));
export const deleteWorkflowHandler: Handler<App> = async (r, a, { id }) =>
  privateJson(await deletion.deleteWorkshopEntry(a.env, 'workflow', id, await readBody(r)));
export const deleteBucketHandler: Handler<App> = async (r, a, { id }) =>
  privateJson(await deletion.deleteWorkshopEntry(a.env, 'bucket', id, await readBody(r)));
export const reviewHandler: Handler<App> = async (r, a, { id }) =>
  privateJson(await review.reviewItem(a.env, id, await readBody(r)));
export const imageHandler: Handler<App> = async (_r, a, { id }) => {
  const o = await workshop.websiteImage(a.env, id);
  return new Response(o.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': `private, max-age=${o.maxAge}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
export const versionHandler: Handler<App> = async (r, a, { id }) =>
  privateJson(await workshop.createVersion(a.env, id, await readBody(r)), 201);
export const exportHandler: Handler<App> = async (_r, a, { id }) => privateJson(await workshop.readVersion(a.env, id));
export const claimHandler: Handler<MachineApp> = async (r, a) =>
  privateJson(await processor.claim(a, await readBody(r)));
export const heartbeatHandler: Handler<MachineApp> = async (r, a, { id }) =>
  privateJson(await processor.heartbeat(a, id, lease(r)));
export const failHandler: Handler<MachineApp> = async (r, a, { id }) =>
  privateJson(await processor.fail(a, id, await readBody(r)));
export const completeHandler: Handler<MachineApp> = async (r, a, { id }) =>
  privateJson(await processor.complete(a, id, await readBody(r, 1500000)));
export const inputHandler: Handler<MachineApp> = async (r, a, { id }) => {
  const o = await processor.input(a, id, lease(r));
  return new Response(o.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(o.size),
      'Cache-Control': 'private, no-store',
    },
  });
};
export const artifactHandler: Handler<MachineApp> = async (r, a, { id, sha }) => {
  const o = await processor.artifact(a, id, sha, lease(r));
  return new Response(o.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(o.bytes),
      'Cache-Control': 'private, no-store',
    },
  });
};
export const uploadHandler: Handler<MachineApp> = async (r, a, { id, sha }) =>
  privateJson(
    await processor.upload(
      a,
      id,
      sha,
      lease(r),
      await readBytes(r, 8 * 1024 * 1024, 'JPEG required.', 'JPEG must be at most 8 MiB.'),
    ),
  );

export const retainHandler: Handler<App> = async (r, a, { id }) => privateJson(await workshop.saveItem(a.env, id));

export const machineVersionHandler: Handler<MachineApp> = async (_r, a, { id }) =>
  privateJson(await workshop.machineVersion(a.env, a.principal, id));
export const machineImageHandler: Handler<MachineApp> = async (_r, a, { id }) => {
  const o = await workshop.machineImage(a.env, a.principal, id);
  return new Response(o.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(o.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

export const detailHandler: Handler<App> = async (_r, a, { id }) => privateJson(await run.runDetail(a.env, id));
export const liveHandler: Handler<App> = async (request, a, { id }) => {
  const sessions = a.env.RUN_SESSIONS;
  if (!sessions || request.headers.get('Upgrade') !== 'websocket')
    return new Response('Live updates are unavailable.', { status: 426 });
  return sessions.get(sessions.idFromName(id)).fetch(request);
};
export const previewHandler: Handler<App> = async (_r, a, { id, item }) => {
  const image = await run.previewImage(a.env, id, item);
  return new Response(image.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
export const progressHandler: Handler<MachineApp> = async (r, a, { id }) =>
  privateJson(await processor.progress(a, id, await readBody(r, 100000)));
export const machinePreviewHandler: Handler<MachineApp> = async (_r, a, { id, item }) => {
  const image = await run.machinePreview(a.env, a.principal, id, item);
  return new Response(image.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(image.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
