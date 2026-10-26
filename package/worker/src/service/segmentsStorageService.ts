import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { parseSegmentStart, RETENTION_MS, segmentKey } from '../../../shared/src/utils/layoutStorageUtil';
import { recordSegment } from '../db/CatalogStorageOps';
import { storeObject } from '../db/FootageStorageOps';
import { MAX_CLOCK_SKEW_MS, MAX_SEGMENT_BYTES } from '../utils/configStorageUtil';
import { requireKnownCamera } from './cameraStorageService';
import type { Env } from '../models/applicationSharedmodel';
import type { Upload, UploadInput, UploadResult, SegmentMetadata, StoreOutcome } from '../models/segmentsStoragemodel';
const SHA256 = /^[0-9a-f]{64}$/;

const DECIMAL = /^\d+(\.\d+)?$/;

const CODEC = /^[a-z0-9]{1,16}$/;

/** Numeric headers the relay sends, and the metadata field each one fills. */
const MEASUREMENT_HEADERS: Record<string, string> = {
  'X-Duration': 'duration_s',
  'X-Frames': 'frames',
  'X-Width': 'width',
  'X-Height': 'height',
  'X-Bitrate': 'bitrate',
};

// --- Validation: everything is checked before any storage call ---

function readUpload(input: UploadInput, env: Env): Upload {
  const { camera: cam, start } = input;
  requireKnownCamera(env, cam);

  const startTime = parseSegmentStart(start);
  if (!startTime) {
    throw new ApplicationError('invalid_input', 'start must look like 20260922T140500Z');
  }
  requireWithinRetention(startTime);
  requireVideoBody(input);

  return {
    cam,
    start: startTime,
    key: segmentKey(cam, startTime),
    metadata: {
      start: startTime.toISOString(),
      sha256: readSha256(input),
      ...readMeasurements(input),
    },
  };
}

function requireWithinRetention(start: Date): void {
  const age = Date.now() - start.getTime();
  if (age > RETENTION_MS || age < -MAX_CLOCK_SKEW_MS) {
    throw new ApplicationError('invalid_input', 'start is outside the retention window');
  }
}

function requireVideoBody(input: UploadInput): void {
  const length = Number(input.contentLength);
  if (!Number.isInteger(length) || length <= 0) {
    throw new ApplicationError('length_required', 'Content-Length is required');
  }
  if (length > MAX_SEGMENT_BYTES) {
    throw new ApplicationError('payload_too_large', `segment is larger than ${MAX_SEGMENT_BYTES} bytes`);
  }
  if (input.contentType !== 'video/mp4') {
    throw new ApplicationError('unsupported_media', 'Content-Type must be video/mp4');
  }
}

function readSha256(input: UploadInput): string {
  const value = input.sha256?.toLowerCase() ?? '';
  if (!SHA256.test(value)) {
    throw new ApplicationError('invalid_input', 'X-Sha256 must be 64 hex characters');
  }
  return value;
}

function readMeasurements(input: UploadInput): SegmentMetadata {
  const measurements: SegmentMetadata = {};
  for (const [header, field] of Object.entries(MEASUREMENT_HEADERS)) {
    const value = input.measurements[header.toLowerCase()] ?? null;
    if (value === null) continue;
    if (!DECIMAL.test(value)) {
      throw new ApplicationError('invalid_input', `${header} must be a number`);
    }
    measurements[field] = value;
  }

  const codec = input.codec;
  if (codec !== null) {
    if (!CODEC.test(codec)) {
      throw new ApplicationError('invalid_input', 'X-Codec must be a codec name such as hevc');
    }
    measurements.codec = codec;
  }
  return measurements;
}
/**
 * PUT /v1/segments/:cam/:start
 *
 * Stores one segment and records it in the catalog. Retrying is safe: the same bytes again return
 * 200, and different bytes at an existing key are refused with 409, never overwritten.
 *
 * If the catalog write fails the response is 503, so the relay retries; the retry finds the file
 * already stored and records it then. The relay's own retry loop is what heals the catalog.
 */
export async function putSegment(env: Env, input: UploadInput): Promise<UploadResult> {
  const upload = readUpload(input, env);
  const { created, size } = await store(env, upload, input.body);
  await catalog(env, upload, size);
  return created ? { key: upload.key, size } : { key: upload.key, stored: 'already' };
}
// --- Storage ---

/** Streams the body to the footage store, which verifies it against the SHA-256. */
async function store(
  env: Env,
  upload: Upload,
  body: ReadableStream | null,
): Promise<{ created: boolean; size: number }> {
  let result: StoreOutcome;
  try {
    result = await storeObject(env, upload, body);
  } catch (error) {
    console.error('footage store unreachable', upload.key, error);
    throw new ApplicationError('unavailable', 'storage unavailable, retry later');
  }
  switch (result.outcome) {
    case 'created':
    case 'already':
      return { created: result.outcome === 'created', size: result.size };
    case 'conflict':
      throw new ApplicationError('conflict', 'a different segment already exists at this key');
    case 'mismatch':
      throw new ApplicationError('invalid_data', 'body does not match X-Sha256');
    case 'refused':
      console.error('footage store refused', upload.key, result.status);
      throw new ApplicationError('unavailable', 'storage unavailable, retry later');
  }
}
async function catalog(env: Env, upload: Upload, size: number): Promise<void> {
  const uploaded = new Date();
  try {
    await recordSegment(
      env.CATALOG,
      {
        key: upload.key,
        cam: upload.cam,
        start: upload.start,
        size,
        uploaded,
        sha256: upload.metadata.sha256!,
        metadata: upload.metadata,
      },
      new Date(uploaded.getTime() - RETENTION_MS).toISOString(),
    );
  } catch (error) {
    console.error('catalog write failed', upload.key, error);
    throw new ApplicationError('unavailable', 'stored, but the catalog is unavailable; retry to record it');
  }
}
