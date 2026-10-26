import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { ProcessorApp } from '../models/processorInferencemodel';
import {
  claimHandler,
  heartbeatHandler,
  completeHandler,
  failHandler,
  evidenceHandler,
} from '../handler/processorInferenceHandler';
export const processorInferenceRoutes = [
  route<ProcessorApp>('POST', '/v1/processor/jobs/claim', claimHandler),
  route<ProcessorApp>('POST', '/v1/processor/jobs/:id/heartbeat', heartbeatHandler),
  route<ProcessorApp>('POST', '/v1/processor/jobs/:id/complete', completeHandler),
  route<ProcessorApp>('POST', '/v1/processor/jobs/:id/fail', failHandler),
  route<ProcessorApp>('PUT', '/v1/processor/jobs/:id/evidence/:sha256', evidenceHandler),
];
