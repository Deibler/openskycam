import { useCallback, useEffect, useState } from 'react';
import { fetchAvailableDays } from '../lib/archive/api.js';
import { addDays, dayKey, parseDay } from '../lib/archive/recordings.js';
import { RETENTION_DAYS } from '../../../shared/src/utils/layoutStorageUtil';
import type { Zone } from '../lib/types';

export type DayAvailability = {
  days: ReadonlySet<string> | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};
type Result = Omit<DayAvailability, 'retry'> & { context: string };

export function useAvailableDays(cam: string, zone: Zone, revision: string | undefined): DayAvailability {
  const today = dayKey(new Date(), zone);
  const context = `${cam}/${zone}/${today}`;
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(count => count + 1), []);
  const [result, setResult] = useState<Result>({ context: '', days: null, loading: true, error: null });
  useEffect(() => {
    if (!cam) return;
    const abort = new AbortController();
    const day = parseDay(today, zone)!;
    const boundaries = Array.from({ length: RETENTION_DAYS + 2 }, (_, index) =>
      addDays(day, index - RETENTION_DAYS, zone),
    );
    setResult(previous => ({
      context,
      days: previous.context === context ? previous.days : null,
      loading: true,
      error: null,
    }));
    // /api/availability takes at most 32 boundaries, so the window goes in two overlapping requests.
    void Promise.all(
      [boundaries.slice(0, 32), boundaries.slice(31)].map(part => fetchAvailableDays(cam, part, abort.signal)),
    )
      .then(parts => {
        const days = parts.flat();
        if (!abort.signal.aborted)
          setResult({
            context,
            days: new Set(days.map(start => dayKey(new Date(start), zone))),
            loading: false,
            error: null,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setResult({ context, days: null, loading: false, error: 'Could not check recording dates.' });
      });
    return () => abort.abort();
  }, [cam, zone, today, context, revision, retryCount]);
  return result.context === context ? { ...result, retry } : { days: null, loading: true, error: null, retry };
}
