import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { Cursor } from '../models/footageStoragemodel';
export function timestamp(value: string | null, name: string): string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ApplicationError('invalid_input', `${name} must be an ISO 8601 timestamp with a time zone.`);
  return new Date(value).toISOString();
}
export function readCursor(value: string, camera: string, from: string, to: string): Cursor {
  try {
    if (value.length > 2048) throw new Error();
    const c = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/'))) as Cursor;
    if (
      c.v !== 1 ||
      c.camera !== camera ||
      c.from !== from ||
      c.to !== to ||
      typeof c.key !== 'string' ||
      c.key.length > 512 ||
      timestamp(c.start, 'cursor') !== c.start ||
      timestamp(c.as_of, 'cursor') !== c.as_of ||
      c.as_of > new Date().toISOString()
    )
      throw new Error();
    return c;
  } catch {
    throw new ApplicationError('invalid_input', 'Invalid cursor, or query changed between pages.');
  }
}
export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify(c)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
