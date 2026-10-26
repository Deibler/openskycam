import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { segmentsBetween } from '../db/CatalogStorageOps';
import { MAX_RANGE_MS } from '../utils/configStorageUtil';
import { requireKnownCamera } from './cameraStorageService';
import type { Env } from '../models/applicationSharedmodel';
import type { SegmentQuery, SegmentList } from '../models/segmentsStoragemodel';

export async function listSegments(env: Env, query: SegmentQuery): Promise<SegmentList> {
  const cam = requireKnownCamera(env, query.camera);
  const from = readTime(query.from, 'from');
  const to = readTime(query.to, 'to');
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ApplicationError('invalid_input', 'to must be after from, at most 48 hours later');
  }
  return {
    cam,
    from: from.toISOString(),
    to: to.toISOString(),
    segments: await segmentsBetween(env.CATALOG, cam, from, to),
  };
}
function readTime(value: string | null, name: string): Date {
  const time = value ? new Date(value) : null;
  if (!time || Number.isNaN(time.getTime()))
    throw new ApplicationError('invalid_input', `${name} must be an ISO 8601 time`);
  return time;
}
