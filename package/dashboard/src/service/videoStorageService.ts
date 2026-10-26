import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { compactTimestamp, parseSegmentStart, segmentKey } from '../../../shared/src/utils/layoutStorageUtil';
import { readVideo } from '../db/VideoStorageOps';
import { requireKnownCamera } from './cameraStorageService';
import { requireApiCamera } from './credentialSharedService';
import type { Env, MachineApp } from '../models/applicationSharedmodel';
import type { VideoQuery, VideoStream, VideoObject } from '../models/videoStoragemodel';

export function getApiVideo(app: MachineApp, query: VideoQuery): Promise<VideoStream> {
  requireApiCamera(app.principal, query.camera);
  return getVideo(app.env, query);
}
export async function getVideo(env: Env, query: VideoQuery): Promise<VideoStream> {
  const { camera: cam, start, range, head } = query;
  requireKnownCamera(env, cam);
  const startTime = parseSegmentStart(start);
  if (!startTime) throw new ApplicationError('invalid_input', 'start must look like 20260922T140500Z');
  if (range !== null && !head && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
    throw new ApplicationError('invalid_range', 'provide one valid byte range');
  const stored = await readRecording(env, segmentKey(cam, startTime), head, range);
  if (!stored) throw new ApplicationError('not_found', 'no segment at that time');
  return { ...stored, filename: `${cam}_${compactTimestamp(startTime)}.mp4` };
}
/** A stored recording (see readVideo), or null when there is none. */
export async function readRecording(
  env: Env,
  key: string,
  head = false,
  range: string | null = null,
): Promise<VideoObject | null> {
  try {
    return await readVideo(env, key, head, range);
  } catch (error) {
    console.error('footage store unavailable', key, error);
    throw new ApplicationError('unavailable', 'footage storage is unavailable, retry later');
  }
}
