import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';

/** Reads `path` now and every `ms` while the page is visible; null reads nothing. Key the caller by path to drop stale data. */
export function usePolled<T>(path: string | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let skipped = false; // the last poll fell while the page was hidden
    async function load() {
      skipped = document.hidden;
      if (!skipped) {
        try {
          const value = await apiRequest<T>(path!, 'GET', undefined, controller.signal);
          if (!controller.signal.aborted) {
            setData(value);
            setError('');
          }
        } catch (e) {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load.');
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), ms);
    }
    // A page opened in a background tab reads when it is shown, not a whole interval later.
    const shown = () => {
      if (document.hidden || !skipped) return;
      clearTimeout(timer);
      void load();
    };
    document.addEventListener('visibilitychange', shown);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [path, ms, tick]);
  return { data, error, refresh: () => setTick(value => value + 1) };
}
