import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App } from '../models/applicationSharedmodel';
import { privateJson } from '../../../shared/src/utils/httpSharedUtil';
import { browseBucket, bucketItem, bucketThumbnail } from '../service/bucketBrowseInferenceService';

export const browseHandler: Handler<App> = async (request, app, { id }) =>
  privateJson(await browseBucket(app.env, id, Object.fromEntries(new URL(request.url).searchParams)));
export const itemHandler: Handler<App> = async (_request, app, { id }) => privateJson(await bucketItem(app.env, id));
export const thumbnailHandler: Handler<App> = async (request, app, { id }) => {
  const image = await bucketThumbnail(
    app.env,
    id,
    Object.fromEntries(new URL(request.url).searchParams),
    request.headers.get('If-None-Match'),
  );
  return new Response(image.body, {
    status: image.notModified ? 304 : 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': `private, max-age=${image.maxAge}`,
      ETag: image.etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
