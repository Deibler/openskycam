import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import { compactTimestamp } from '../../../shared/src/utils/layoutStorageUtil';
import type { MachineApp } from '../models/applicationSharedmodel';
import type { AgentContent, AgentTool } from '../models/agentSharedmodel';
import type { WorkshopRunDetail } from '../models/workshopInferencemodel';
import { action, number, reply, text } from '../utils/agentSharedUtil';
import { getOverview } from './overviewStorageService';
import { getAvailability } from './calendarStorageService';
import { listRecordings } from './footageStorageService';
import { requireApiCamera, signLinks } from './credentialSharedService';
import { photoDetail, requestPhoto } from './workshopPhotoInferenceService';
import { nextRunUpdate, runFinished } from './workshopLiveInferenceService';
import { previewImage } from './workshopRunInferenceService';
import { agentView } from './agentImageInferenceService';

const DAY = 86400000;
const actions = ['cameras', 'days', 'list', 'download', 'photo'] as const;
const camera = (app: MachineApp, args: JsonObject) =>
  requireApiCamera(app.principal, text(args, 'camera') ?? app.principal.cameras[0] ?? null);
const recordingPath = (cam: string, start: string) =>
  `/v1/recordings/${encodeURIComponent(cam)}/${compactTimestamp(new Date(start))}/file`;

async function cameras(app: MachineApp) {
  const summaries = await Promise.all(
    app.principal.cameras.map(async cam => {
      const o = await getOverview({ env: app.env, viewer: { email: '' } }, cam);
      return {
        camera: cam,
        receiving: o.health.healthy,
        newest_recording: o.health.newest_start,
        newest_upload: o.health.newest_uploaded_at,
        last_24h: o.last_24h,
        stored: o.retained,
        storage_projection: o.projection,
      };
    }),
  );
  return reply({ cameras: summaries, times: 'UTC' }, 'footage days shows which dates have recordings.');
}

async function days(app: MachineApp, args: JsonObject) {
  const cam = camera(app, args),
    month = text(args, 'month') ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new ApplicationError('invalid_input', 'month must look like 2026-09.');
  const start = Date.parse(`${month}-01T00:00:00Z`),
    end = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1);
  const bounds = Array.from({ length: Math.round((end - start) / DAY) + 1 }, (_, i) => start + i * DAY);
  const found = await getAvailability(app.env, cam, bounds.join(','));
  return reply(
    { camera: cam, month, days_with_footage: found.days.map(d => d.slice(0, 10)) },
    'footage list with from/to on one of these days shows its recordings.',
  );
}

async function list(app: MachineApp, args: JsonObject) {
  const page = await listRecordings(app.env, app.principal, {
    camera: camera(app, args),
    from: text(args, 'from', true)!,
    to: text(args, 'to', true)!,
    limit: String(number(args, 'limit', 1, 500, 100)),
    cursor: text(args, 'cursor', false, 2000) ?? null,
  });
  return reply(
    {
      camera: page.camera,
      from: page.from,
      to: page.to,
      recordings: page.recordings.map(r => ({
        start: r.start,
        seconds: r.duration_s,
        bytes: r.size,
        width: r.width,
        height: r.height,
        codec: r.codec,
      })),
      next_cursor: page.next_cursor,
    },
    page.next_cursor
      ? 'More recordings: repeat with cursor.'
      : 'footage download gives links; footage photo takes a still.',
  );
}

async function download(app: MachineApp, args: JsonObject) {
  const cam = camera(app, args),
    at = text(args, 'at');
  const from = at ?? text(args, 'from', true)!,
    to = at ? new Date(Date.parse(at) + 1).toISOString() : text(args, 'to', true)!;
  // A recording that started before `at` still covers it, so look back one clip length.
  const page = await listRecordings(app.env, app.principal, {
    camera: cam,
    from: at ? new Date(Date.parse(at) - 300000).toISOString() : from,
    to,
    limit: '60',
    cursor: null,
  });
  const rows = at
    ? page.recordings.filter(
        r => Date.parse(r.start) <= Date.parse(at) && Date.parse(at) < Date.parse(r.start) + (r.duration_s ?? 0) * 1000,
      )
    : page.recordings;
  if (!rows.length)
    throw new ApplicationError(
      'not_found',
      'No recordings there. Use footage days and footage list to find recorded times.',
    );
  const links = await signLinks(
    app.env,
    app.principal,
    rows.map(r => recordingPath(cam, r.start)),
  );
  return reply(
    {
      camera: cam,
      files: rows.map((r, i) => ({
        start: r.start,
        seconds: r.duration_s,
        bytes: r.size,
        filename: `${cam}_${compactTimestamp(new Date(r.start))}.mp4`,
        url: links[i].url,
      })),
      total_bytes: rows.reduce((n, r) => n + r.size, 0),
      links_expire_at: links[0].expires_at,
      truncated: !!page.next_cursor,
      format: 'MP4 (HEVC). Play in QuickTime/Safari or convert with ffmpeg.',
    },
    `Save each with: curl -fL -o <filename> "<url>"${page.next_cursor ? '. Only the first 60 are listed; narrow from/to for the rest.' : ''}`,
  );
}

async function photo(app: MachineApp, args: JsonObject): Promise<AgentContent[]> {
  const deadline = Date.now() + number(args, 'wait_seconds', 0, 45, 30) * 1000;
  const id =
    text(args, 'photo_id') ?? (await requestPhoto(app.env, app.principal, camera(app, args), text(args, 'at', true)));
  let detail: WorkshopRunDetail = await photoDetail(app.env, app.principal, id);
  while (!runFinished(detail) && Date.now() < deadline)
    detail = (await nextRunUpdate(app.env, id, deadline - Date.now())).detail;
  const job = detail.jobs[0];
  if (!runFinished(detail))
    return reply(
      { photo_id: id, status: detail.status, phase: job?.progress?.phase ?? 'waiting for the processor' },
      'Still decoding. Call footage photo again with this photo_id.',
    );
  const image = detail.images[0];
  if (detail.status !== 'completed' || !image)
    throw new ApplicationError(
      'unavailable',
      `The photo could not be made (${detail.status}${job?.error ? `: ${job.error}` : ''}). Ask for it again, or check runs runtimes.`,
    );
  const provenance = JSON.parse(image.provenance_json) as { width: number; height: number; source: { start: string } };
  const [link] = await signLinks(app.env, app.principal, [`/v1/workshop/runs/${id}/previews/${image.id}/image`]);
  const view = await agentView(
    app.env,
    (await previewImage(app.env, id, image.id)).body,
    number(args, 'size', 128, 1600, 1024),
  );
  return [
    ...reply(
      {
        photo_id: id,
        camera: image.cam,
        captured_at: image.captured_at,
        recording_start: provenance.source.start,
        width: provenance.width,
        height: provenance.height,
        full_size: link,
        available_until: detail.preview_expires_at,
        shown: view ? 'downscaled below' : 'image preview unavailable; use the full_size link',
      },
      'Download the full frame with curl -fL -o photo.jpg "<full_size.url>".',
    ),
    ...(view ? [view] : []),
  ];
}

async function footage(app: MachineApp, args: JsonObject) {
  switch (action(args, actions)) {
    case 'cameras':
      return cameras(app);
    case 'days':
      return days(app, args);
    case 'list':
      return list(app, args);
    case 'download':
      return download(app, args);
    default:
      return photo(app, args);
  }
}

export const footageTool: AgentTool = {
  name: 'footage',
  title: 'Footage and photos',
  description:
    'Recorded sky-camera video. All times are UTC ISO 8601. Actions: cameras (your cameras, upload health, storage); days (dates with footage in a month); list (recordings from–to); download (curl-ready links for the recording at `at`, or every recording from–to; links last 1 hour); photo (a still JPEG from stored video at `at`, decoded by the processor in ~5–30 s; if not ready, call again with photo_id). Read guide footage first.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...actions] },
      camera: { type: 'string', description: 'Camera ID such as sky01. Defaults to your first camera.' },
      month: { type: 'string', description: 'days: YYYY-MM (UTC). Defaults to this month.' },
      from: { type: 'string', description: 'list/download: start, e.g. 2026-09-24T13:00:00Z' },
      to: {
        type: 'string',
        description: 'list/download: end (exclusive). list spans at most the range the API allows.',
      },
      at: { type: 'string', description: 'download/photo: an instant, e.g. 2026-09-24T13:05:30Z' },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'list: page size (default 100)' },
      cursor: { type: 'string', description: 'list: next_cursor from the previous page' },
      photo_id: { type: 'string', description: 'photo: collect a photo requested earlier' },
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        maximum: 45,
        description: 'photo: how long to wait for decoding (default 30)',
      },
      size: {
        type: 'integer',
        minimum: 128,
        maximum: 1600,
        description: 'photo: longest side of the image shown to you (default 1024)',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: footage,
};
