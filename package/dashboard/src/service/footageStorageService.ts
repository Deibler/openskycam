import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { requireApiCamera } from './credentialSharedService';
import { queryRecordings } from '../db/FootageStorageOps';
import { timestamp, readCursor, encodeCursor } from './cursorStorageService';
import type { Env } from '../models/applicationSharedmodel';
import type { ApiPrincipal } from '../models/credentialSharedmodel';
import type { FootageQuery, FootagePage } from '../models/footageStoragemodel';
/** Indexed, bounded pages across the lake. The timestamp bound keeps new uploads out of later pages. */
export async function listRecordings(env: Env, principal: ApiPrincipal, query: FootageQuery): Promise<FootagePage> {
  const camera = requireApiCamera(principal, query.camera);
  const from = timestamp(query.from, 'from');
  const to = timestamp(query.to, 'to');
  if (from >= to) throw new ApplicationError('invalid_input', 'to must be later than from.');
  const rawLimit = query.limit ?? '100';
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 500)
    throw new ApplicationError('invalid_input', 'limit must be between 1 and 500.');
  const limit = Number(rawLimit);
  const rawCursor = query.cursor;
  const cursor = rawCursor ? readCursor(rawCursor, camera, from, to) : null;
  const asOf = cursor?.as_of ?? new Date().toISOString();
  const results = await queryRecordings(env.CATALOG, camera, from, to, asOf, cursor, limit);
  const more = results.length > limit;
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor =
    more && last
      ? encodeCursor({
          v: 1,
          camera,
          from,
          to,
          as_of: asOf,
          start: last.start,
          key: last.object_key,
        })
      : null;
  return {
    camera,
    from,
    to,
    as_of: asOf,
    recordings: rows,
    next_cursor: nextCursor,
  };
}
