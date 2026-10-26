import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { CAM, seedSegment } from './helpers';
import { queryRecordings } from '../src/db/FootageStorageOps';

describe('footage window', () => {
  it('leaves out a recording that ends exactly when the window opens', async () => {
    const base = Date.parse('2026-08-01T00:00:12.000Z');
    const days = Array.from({ length: 40 }, (_, i) => new Date(base + i * 86_400_000 + i * 3_000));
    for (const start of days) await seedSegment({ start, durationS: 63.06 });
    const asOf = new Date().toISOString();
    const listed: string[] = [];
    for (const start of days) {
      const from = new Date(+start + 63_060).toISOString(),
        to = new Date(+start + 123_060).toISOString();
      if ((await queryRecordings(env.CATALOG, CAM, from, to, asOf, null, 10)).length) listed.push(start.toISOString());
    }
    expect(listed).toEqual([]);
  });
});
