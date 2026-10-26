import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';
import type { WorkshopRunDetail } from '../../../../src/models/workshopInferencemodel';

/** Live socket while a run is active. A dropped socket falls back to a short poll. */
export function useWorkshopRun(id: string) {
  const [run, setRun] = useState<WorkshopRunDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    setRun(null);
    setError('');
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let pending = false;
    let live = false;
    let stopped = false;
    const finished = (status: string) => !['queued', 'running'].includes(status);
    async function load() {
      if (pending || controller.signal.aborted || document.hidden) return;
      clearTimeout(timer);
      pending = true;
      let delay = 4000;
      try {
        const result = await apiRequest<WorkshopRunDetail>(
          `/api/workshop/runs/${encodeURIComponent(id)}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRun(result);
        setError('');
        delay = finished(result.status) ? 0 : live ? 0 : 1500;
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not refresh run.');
      } finally {
        pending = false;
        if (!controller.signal.aborted && delay) timer = setTimeout(() => void load(), delay);
      }
    }
    function connect() {
      if (stopped || controller.signal.aborted || document.hidden) return;
      socket?.close();
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const next = new WebSocket(`${proto}//${location.host}/api/workshop/runs/${encodeURIComponent(id)}/live`);
      socket = next;
      next.onmessage = event => {
        const value = JSON.parse(String(event.data)) as WorkshopRunDetail & { error?: string };
        if (value.error) {
          setError(value.error);
          return;
        }
        live = true;
        setRun(value);
        setError('');
        if (finished(value.status)) {
          stopped = true;
          next.close();
        }
      };
      next.onclose = () => {
        if (socket !== next || stopped || controller.signal.aborted || document.hidden) return;
        live = false;
        void load();
        timer = setTimeout(connect, 1000);
      };
    }
    const visible = () => {
      if (document.hidden) {
        clearTimeout(timer);
        socket?.close();
      } else {
        void load();
        connect();
      }
    };
    void load();
    connect();
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      socket?.close();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [id, revision]);
  async function cancel() {
    try {
      await apiRequest(`/api/workshop/runs/${encodeURIComponent(id)}/cancel`, 'POST', {});
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel.');
    }
  }
  return { run, error, refresh, cancel };
}
