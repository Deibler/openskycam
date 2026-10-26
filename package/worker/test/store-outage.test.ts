import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { randomBytes, startMinutesAgo, uploadSegment } from './helpers';

// Its own file: the broken store credential would affect every later test sharing this file's env.
it('answers 503 and catalogs nothing when the footage store refuses the upload', async () => {
  env.STORE_TOKEN = 'stale'; // the store answers 401, as it would to a rotated secret

  const response = await uploadSegment(startMinutesAgo(40), randomBytes(2_000));

  expect(response.status).toBe(503);
  const { n } = (await env.CATALOG.prepare('SELECT COUNT(*) AS n FROM segments').first<{ n: number }>())!;
  expect(n).toBe(0);
});
