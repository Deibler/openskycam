import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOverview, fetchSegments, SessionExpiredError } from '../lib/archive/api.js';
import { addDays, dayKey, parseDay, startOfDay } from '../lib/archive/recordings.js';
import { RETENTION_DAYS } from '../../../shared/src/utils/layoutStorageUtil';
import type { Overview, Segment, Selection, Zone } from '../lib/types';

type Route = {
  day: string;
  zone: Zone;
  cam: string | null;
  at: string | null;
  offset: number;
  view: 'recordings' | 'activity' | 'api' | 'models' | 'workshop';
  play: boolean;
  revision: number;
};
function readRoute(): Route {
  let search = location.search;
  if (!search) {
    try {
      search = localStorage.getItem('skyvision-playback') ?? '';
    } catch {
      /* URL navigation still works without storage. */
    }
  }
  const q = new URLSearchParams(search);
  const zone = q.get('tz') === 'UTC' ? 'UTC' : 'local';
  const today = startOfDay(new Date(), zone);
  // A link names a moment; its day in this viewer's time zone can differ from the one in the link.
  const at = q.get('at');
  const moment = at && Number.isFinite(Date.parse(at)) ? startOfDay(new Date(at), zone) : null;
  const date = moment ?? parseDay(q.get('day') ?? '', zone) ?? today;
  const bounded = new Date(
    Math.min(today.getTime(), Math.max(addDays(today, -RETENTION_DAYS, zone).getTime(), date.getTime())),
  );
  const offset = Number(q.get('t') ?? 0);
  return {
    day: dayKey(bounded, zone),
    zone,
    cam: q.get('cam'),
    at,
    offset: Number.isFinite(offset) ? Math.max(0, Math.min(offset, 86400)) : 0,
    view:
      q.get('view') === 'workshop'
        ? 'workshop'
        : q.get('view') === 'models'
          ? 'models'
          : q.get('view') === 'api'
            ? 'api'
            : q.get('view') === 'activity'
              ? 'activity'
              : 'recordings',
    play: false,
    revision: 0,
  };
}
function writeRoute(route: Route, cam: string | null, at: string | null, push = false, offset = 0) {
  const q = new URLSearchParams({ day: route.day, tz: route.zone });
  if (cam) q.set('cam', cam);
  if (at) q.set('at', at);
  if (at && offset > 0) q.set('t', String(Math.round(offset * 10) / 10));
  if (route.view !== 'recordings') q.set('view', route.view);
  if (route.view === 'api' && new URLSearchParams(location.search).get('tab') === 'docs') q.set('tab', 'docs');
  if (route.view === 'models') {
    const current = new URLSearchParams(location.search);
    for (const key of [
      'model',
      'modelsTab',
      'modelSection',
      'modelQuery',
      'modelFilter',
      'modelSort',
      'modelMode',
      'testCam',
      'testDay',
      'testAt',
    ]) {
      const value = current.get(key);
      if (value) q.set(key, value);
    }
  }
  const url = `${location.pathname}?${q}`;
  if (url !== `${location.pathname}${location.search}`) history[push ? 'pushState' : 'replaceState']({}, '', url);
  if (route.view === 'recordings' && at) {
    try {
      localStorage.setItem('skyvision-playback', `?${q}`);
    } catch {
      /* The address still preserves the position. */
    }
  }
}
/** The linked recording and position when the day has it, otherwise the day's newest recording from its start. */
function linked(rows: Segment[], route: Route) {
  const chosen = rows.find(s => s.start === route.at) ?? rows.at(-1);
  const offset = chosen?.start === route.at ? Math.min(route.offset, Math.max(0, (chosen.duration_s ?? 60) - 0.01)) : 0;
  return { chosen, offset };
}
export function useArchive() {
  const [route, setRoute] = useState(readRoute);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const sequence = useRef(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const playbackPosition = useRef({ start: '', offset: 0 });
  const persistedPosition = useRef('');
  const current = useRef({ route, overview, selection });
  current.current = { route, overview, selection };
  const cam = overview?.cam ?? route.cam ?? '';
  const day = parseDay(route.day, route.zone)!;

  useEffect(() => {
    const pop = () => setRoute({ ...readRoute(), revision: Date.now() });
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelection(null);
    setSegments([]);
    void (async () => {
      try {
        const summary = await fetchOverview(route.cam);
        if (token !== generation.current) return;
        setOverview(summary);
        const date = parseDay(route.day, route.zone)!;
        const rows = await fetchSegments(summary.cam, date, addDays(date, 1, route.zone), controller.signal);
        if (token !== generation.current) return;
        setSegments(rows);
        const { chosen, offset } = linked(rows, route);
        playbackPosition.current = { start: chosen?.start ?? '', offset };
        setSelection(chosen ? { segment: chosen, id: ++sequence.current, offset, play: route.play } : null);
        writeRoute(current.current.route, summary.cam, chosen?.start ?? null, false, offset);
      } catch (e) {
        if (!controller.signal.aborted && token === generation.current)
          setError(e instanceof Error ? e : new Error('Could not load recordings.'));
      } finally {
        if (token === generation.current) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [route.day, route.zone, route.cam, route.at, route.offset, route.revision]);

  const select = useCallback((segment: Segment, play = true, offset = 0) => {
    playbackPosition.current = { start: segment.start, offset };
    setSelection({ segment, play, offset, id: ++sequence.current });
    const latest = current.current;
    const next = { ...latest.route, view: 'recordings' as const };
    setRoute(previous => ({ ...previous, view: 'recordings' }));
    writeRoute(next, latest.overview?.cam ?? latest.route.cam, segment.start, false, offset);
  }, []);
  const trackProgress = useCallback((start: string, offset: number, exact = false) => {
    const latest = current.current;
    if (latest.selection?.segment.start !== start || !Number.isFinite(offset)) return;
    playbackPosition.current = { start, offset };
    const key = `${start}/${Math.floor(offset)}`;
    if ((!exact && key === persistedPosition.current) || latest.route.view !== 'recordings') return;
    persistedPosition.current = key;
    writeRoute(latest.route, latest.overview?.cam ?? latest.route.cam, start, false, offset);
  }, []);
  const navigate = useCallback((patch: Partial<Route>) => {
    const latest = current.current;
    const next = { ...latest.route, at: null, offset: 0, play: false, ...patch };
    writeRoute(next, next.cam ?? latest.overview?.cam ?? null, next.at, true);
    setRoute(next);
  }, []);
  // Stable, so views that rebuild on a new callback (the Activity charts) keep their focus between refreshes.
  const changeDay = useCallback(
    (value: string, zone = current.current.route.zone, at: string | null = null, play = false, offset = 0) => {
      const max = dayKey(new Date(), zone);
      const min = dayKey(addDays(new Date(), -RETENTION_DAYS, zone), zone);
      if (parseDay(value, zone))
        navigate({
          day: value < min ? min : value > max ? max : value,
          zone,
          at,
          offset,
          play,
          view: 'recordings',
          revision: Date.now(),
        });
    },
    [navigate],
  );
  const changeView = useCallback((view: Route['view']) => {
    const latest = current.current;
    const next = { ...latest.route, view };
    writeRoute(
      next,
      latest.overview?.cam ?? latest.route.cam,
      latest.selection?.segment.start ?? null,
      true,
      playbackPosition.current.offset,
    );
    setRoute(next);
    window.dispatchEvent(new Event('skyvision:navigate'));
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const token = generation.current;
    const latest = current.current;
    try {
      const summary = await fetchOverview(latest.overview?.cam ?? latest.route.cam);
      const date = parseDay(latest.route.day, latest.route.zone)!;
      const rows = await fetchSegments(summary.cam, date, addDays(date, 1, latest.route.zone));
      if (token !== generation.current) return;
      setOverview(summary);
      setSegments(rows);
      setError(null);
      setSelection(previous => {
        const kept = previous && rows.find(s => s.start === previous.segment.start);
        if (kept && previous) return { ...previous, segment: kept };
        // Retry after a failed first load still opens the linked moment.
        const { chosen, offset } = linked(rows, latest.route);
        return chosen ? { segment: chosen, id: ++sequence.current, offset, play: false } : null;
      });
    } catch (e) {
      if (token === generation.current) setError(e instanceof Error ? e : new Error('Refresh failed.'));
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function latest() {
    try {
      const summary = await fetchOverview(cam);
      if (summary.health.newest_start) {
        setOverview(summary);
        changeDay(
          dayKey(new Date(summary.health.newest_start), route.zone),
          route.zone,
          summary.health.newest_start,
          true,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Could not load the latest recording.'));
    }
  }
  return {
    route,
    overview,
    cam,
    day,
    segments,
    selection,
    loading,
    refreshing,
    error,
    sessionExpired: error instanceof SessionExpiredError,
    select,
    trackProgress,
    playbackPosition,
    changeDay,
    changeView,
    refresh,
    latest,
    changeCamera: (cam: string) => navigate({ cam, revision: Date.now() }),
  };
}
