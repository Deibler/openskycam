import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { parseSegmentStart, segmentKey } from '../../shared/src/utils/layoutStorageUtil';
import { CAM, randomBytes, startMinutesAgo, storedBytes, uploadSegment } from './helpers';

// Its own file: breaking the catalog would affect every later test sharing this file's storage.
it('answers 503 when the catalog is down, after keeping the segment in the store', async () => {
  await env.CATALOG.exec('DROP TABLE segments');
  const start = startMinutesAgo(50);

  const response = await uploadSegment(start, randomBytes(2_000));

  expect(response.status).toBe(503);
  expect(await storedBytes(segmentKey(CAM, parseSegmentStart(start)!))).not.toBeNull();
});
