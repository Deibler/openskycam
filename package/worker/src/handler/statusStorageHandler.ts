import { json } from '../../../shared/src/utils/httpSharedUtil';
import { getStatus } from '../service/statusStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { Env } from '../models/applicationSharedmodel';
export const statusHandler: Handler<Env> = async (_request, env) => {
  const status = await getStatus(env);
  return json(status, status.healthy ? 200 : 503);
};
