import { getVideo, getApiVideo } from '../service/videoStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { App, MachineApp } from '../models/applicationSharedmodel';
import type { VideoStream } from '../models/videoStoragemodel';
export const videoHandler: Handler<App> = async (request, app, { cam, start }, url) =>
  videoResponse(
    await getVideo(app.env, {
      camera: cam,
      start,
      range: request.headers.get('Range'),
      head: request.method === 'HEAD',
    }),
    url.searchParams.has('download'),
  );
export const apiVideoHandler: Handler<MachineApp> = async (request, app, { camera, start }) => {
  const response = videoResponse(
    await getApiVideo(app, {
      camera,
      start,
      range: request.headers.get('Range'),
      head: request.method === 'HEAD',
    }),
    true,
  );
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};
function videoResponse(video: VideoStream, download: boolean): Response {
  const { size, etag, body, range, filename, invalidRange } = video;
  if (invalidRange)
    return Response.json(
      { error: 'requested range is not satisfiable' },
      {
        status: 416,
        headers: {
          'Content-Range': `bytes */${size}`,
          'Cache-Control': 'no-store',
        },
      },
    );
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  });
  if (etag) headers.set('ETag', etag);
  if (download) headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set('Content-Length', String(range.length));
    return new Response(body, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  return new Response(body, { headers });
}
