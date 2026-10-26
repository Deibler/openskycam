import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { availableDays } from '../db/CatalogStorageOps';
import { HOUR_MS } from '../utils/configStorageUtil';
import { requireKnownCamera } from './cameraStorageService';
import type { Env } from '../models/applicationSharedmodel';
import type { CalendarAvailability } from '../models/calendarStoragemodel';
/** Calendar-day boundaries as epoch milliseconds; local days can be 23 or 25 hours. */
export async function getAvailability(
  env: Env,
  camera: string | null,
  rawBoundaries: string | null,
): Promise<CalendarAvailability> {
  const cam = requireKnownCamera(env, camera);
  const values = (rawBoundaries ?? '').split(',');
  const boundaries = values.map(value => new Date(Number(value)));
  if (
    values.length < 2 ||
    values.length > 32 ||
    values.some(
      (value, index) =>
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        !Number.isFinite(boundaries[index].getTime()) ||
        (index > 0 &&
          (boundaries[index].getTime() - boundaries[index - 1].getTime() < 20 * HOUR_MS ||
            boundaries[index].getTime() - boundaries[index - 1].getTime() > 28 * HOUR_MS)),
    )
  )
    throw new ApplicationError(
      'invalid_input',
      'provide 2 to 32 consecutive calendar-day boundaries in epoch milliseconds',
    );
  return { cam, days: await availableDays(env.CATALOG, cam, boundaries) };
}
