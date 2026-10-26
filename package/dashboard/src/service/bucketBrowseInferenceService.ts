import type { Env } from '../models/applicationSharedmodel';
import type {
  BucketBrowseCursor,
  BucketBrowseFilter,
  BucketBrowsePage,
  BucketItemDetail,
  BucketThumbnail,
} from '../models/bucketBrowseInferencemodel';
import type { WorkshopAnnotation, WorkshopSnapshot } from '../models/workshopInferencemodel';
import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import * as ops from '../db/BucketBrowseInferenceOps';
import * as workshop from '../db/WorkshopInferenceOps';
import { thumbnail } from '../db/ImageSharedOps';
import { browserCacheSeconds, loadWorkshop } from './workshopInferenceService';
import { invalid } from './workshopValidationInferenceService';
import { recordingOf } from '../utils/recordingInferenceUtil';
import { thumbnailCrop, thumbnailFile, thumbnailKey } from '../utils/thumbnailInferenceUtil';

function filter(bucket: string, query: Record<string, string>, now: string): BucketBrowseFilter {
  function number(key: string, fallback: number, max: number) {
    const value = query[key] ? Number(query[key]) : fallback;
    if (!Number.isFinite(value) || value < 0 || value > max) invalid(`Invalid ${key}.`);
    return value;
  }
  function date(value: string | undefined) {
    if (!value) return '';
    if (!Number.isFinite(Date.parse(value))) invalid('Use a valid capture date.');
    return new Date(value).toISOString();
  }
  let cursor: BucketBrowseCursor | null = null;
  if (query.cursor) {
    try {
      cursor = JSON.parse(atob(query.cursor));
    } catch {
      invalid('Invalid page cursor.');
    }
    if (!cursor || typeof cursor.id !== 'string' || cursor.id.length > 200 || !cursor.at || !cursor.snapshot)
      invalid('Invalid page cursor.');
    date(cursor.at);
    date(cursor.snapshot);
  }
  if (query.review && !['pending', 'accepted', 'rejected'].includes(query.review)) invalid('Invalid review status.');
  if (query.sort && !['newest', 'oldest'].includes(query.sort)) invalid('Invalid capture order.');
  const f: BucketBrowseFilter = {
    bucket,
    run: query.run ?? '',
    camera: query.camera ?? '',
    className: query.class ?? '',
    review: query.review ?? '',
    saved: query.saved === 'true',
    query: (query.q ?? '').slice(0, 200),
    from: date(query.from),
    to: date(query.to),
    minConfidence: number('min_confidence', 0, 1),
    maxConfidence: number('max_confidence', 1, 1),
    minObjects: number('min_objects', 0, 100),
    maxObjects: number('max_objects', 100, 100),
    oldest: query.sort === 'oldest',
    snapshot: cursor?.snapshot ?? now,
    after: cursor ? { at: cursor.at, id: cursor.id } : null,
    limit: number('limit', 120, 200),
  };
  if (
    !Number.isInteger(f.limit) ||
    f.limit < 1 ||
    !Number.isInteger(f.minObjects) ||
    !Number.isInteger(f.maxObjects) ||
    f.minObjects > f.maxObjects ||
    f.minConfidence > f.maxConfidence ||
    (f.from && f.to && f.from >= f.to)
  )
    invalid('Check the filter range.');
  return f;
}

export async function browseBucket(env: Env, id: string, query: Record<string, string>): Promise<BucketBrowsePage> {
  if (!(await loadWorkshop(env)).document.buckets.some(b => b.id === id))
    throw new ApplicationError('not_found', 'Bucket not found.');
  const now = new Date().toISOString(),
    f = filter(id, query, now);
  const [page, facets] = await Promise.all([ops.browse(env, f, now), ops.facets(env, id, now)]);
  const items = page.items.slice(0, f.limit),
    last = items.at(-1);
  return {
    items: items.map(item => ({ ...item, image_url: `/api/workshop/items/${encodeURIComponent(item.id)}/image` })),
    total: page.total,
    facets,
    cursor:
      page.items.length > f.limit && last
        ? btoa(JSON.stringify({ at: last.captured_at, id: last.id, snapshot: f.snapshot }))
        : null,
  };
}

export async function bucketItem(env: Env, id: string): Promise<BucketItemDetail> {
  const item = await workshop.item(env, id, new Date().toISOString());
  if (!item) throw new ApplicationError('not_found', 'Image expired or missing.');
  const run = await workshop.run(env, item.run_id);
  if (!run) throw new ApplicationError('not_found', 'Run not found.');
  const snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot;
  const provenance = JSON.parse(item.provenance_json);
  const classes =
    provenance.annotation_model?.classes ??
    snapshot.models.find(m => m.node_id === (JSON.parse(item.annotation_json) as WorkshopAnnotation[])[0]?.model_node)
      ?.model.classes ??
    [];
  return {
    item: { ...item, image_url: `/api/workshop/items/${encodeURIComponent(id)}/image` },
    recording: recordingOf(provenance),
    run: { id: run.id, name: run.name, created_at: run.created_at },
    classes,
  };
}

/**
 * Small browser previews, made by the footage store; full originals remain on the
 * existing image endpoint. Each is made once and kept beside its photo, so later views, on any device,
 * neither wait for nor ask the store again.
 */
export async function bucketThumbnail(
  env: Env,
  id: string,
  query: Record<string, string>,
  ifNoneMatch: string | null,
): Promise<BucketThumbnail> {
  const now = new Date().toISOString();
  const item = await workshop.item(env, id, now);
  if (!item) throw new ApplicationError('not_found', 'Image expired or missing.');
  const size = query.size === '512' ? 512 : 256,
    object = query.mode === 'object';
  const etag = `"${await sha256(`${item.sha256}/${object ? item.annotation_json : ''}/${size}/${object}`)}"`;
  const maxAge = browserCacheSeconds(item.expires_at);
  if (etag === ifNoneMatch) return { body: null, etag, maxAge, notModified: true };
  const key = thumbnailKey(item.id, thumbnailFile(object ? 'object' : 'frame', size));
  const kept = await ops.keptThumbnail(env, key, etag);
  if (kept) return { body: kept, etag, maxAge, notModified: false };
  const p = JSON.parse(item.provenance_json),
    width = Number(p.width) || 1920,
    height = Number(p.height) || 1080;
  const box = object
    ? (JSON.parse(item.annotation_json) as WorkshopAnnotation[])
        .filter(a => a.box)
        .sort((a, b) => b.confidence - a.confidence)[0]?.box
    : undefined;
  const crop = box ? thumbnailCrop(width, height, box) : undefined;
  const image = await workshop.image(env, item.object_key);
  if (!image) throw new ApplicationError('not_found', 'Image bytes are no longer available.');
  let body: ArrayBuffer;
  try {
    body = await thumbnail(env, image.body, size, crop);
  } catch (error) {
    console.warn('Thumbnail transform failed', id, error);
    throw new ApplicationError('unavailable', 'Thumbnail could not be generated.');
  }
  try {
    await ops.keepThumbnail(env, item.id, key, etag, body, await sha256(body), now);
  } catch (error) {
    // The browser still gets this one; the next request makes it again.
    console.warn('Thumbnail could not be kept', id, error);
  }
  return { body, etag, maxAge, notModified: false };
}
