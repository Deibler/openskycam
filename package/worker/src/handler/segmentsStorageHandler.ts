import { json } from '../../../shared/src/utils/httpSharedUtil';
import { putSegment } from '../service/segmentsStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { Env } from '../models/applicationSharedmodel';
export const uploadHandler: Handler<Env> = async (request, env, { cam, start }) => {
  const result = await putSegment(env, {
    camera: cam,
    start,
    body: request.body,
    contentLength: request.headers.get('Content-Length'),
    contentType: request.headers.get('Content-Type'),
    sha256: request.headers.get('X-Sha256'),
    codec: request.headers.get('X-Codec'),
    measurements: Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value])),
  });
  return json(result, 'stored' in result ? 200 : 201);
};
