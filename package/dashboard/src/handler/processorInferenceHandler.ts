import { privateJson, readBody, readBytes } from '../../../shared/src/utils/httpSharedUtil';
import { compactTimestamp } from '../../../shared/src/utils/layoutStorageUtil';
import * as processor from '../service/processorInferenceService';
import { complete } from '../service/resultInferenceService';
import { evidence } from '../service/evidenceInferenceService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { ProcessorApp } from '../models/processorInferencemodel';
export const claimHandler: Handler<ProcessorApp> = async (request, app, _params, url) => {
  const { job } = await processor.claim(app, await readBody(request));
  return privateJson({
    job: job
      ? {
          ...job,
          input: {
            ...job.input,
            download_url: `${url.origin}/v1/recordings/${job.input.cam}/${compactTimestamp(new Date(job.input.start))}/file`,
          },
        }
      : null,
  });
};
export const heartbeatHandler: Handler<ProcessorApp> = async (request, app, { id }) =>
  privateJson(await processor.heartbeat(app, id, await readBody(request)));
export const completeHandler: Handler<ProcessorApp> = async (request, app, { id }) =>
  privateJson(await complete(app, id, await readBody(request, 2 * 1024 * 1024)));
export const failHandler: Handler<ProcessorApp> = async (request, app, { id }) =>
  privateJson(await processor.fail(app, id, await readBody(request)));
export const evidenceHandler: Handler<ProcessorApp> = async (request, app, { id, sha256 }) =>
  privateJson(
    await evidence(
      app,
      id,
      sha256,
      {
        lease_token: request.headers.get('X-Lease-Token'),
        generation: Number(request.headers.get('X-Lease-Generation')),
      },
      request.headers.get('Content-Type'),
      await readBytes(request, 4 * 1024 * 1024, 'Evidence body required.', 'JPEG exceeds 4 MiB.'),
    ),
  );
