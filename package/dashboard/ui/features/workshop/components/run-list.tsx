import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { apiRequest } from '../../../lib/api-request';
import type { RunListProps } from '../models/runInferencemodel';
import type { WorkshopRunStatus, WorkshopSnapshot } from '../../../../src/models/workshopInferencemodel';
export function RunList({ onWorkflows, onRun }: RunListProps) {
  const [runs, setRuns] = useState<WorkshopRunStatus[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.hidden) {
        timer = setTimeout(() => void load(), 4000);
        return;
      }
      try {
        const r = await apiRequest<{ runs: WorkshopRunStatus[] }>(
          '/api/workshop/runs',
          'GET',
          undefined,
          controller.signal,
        );
        setRuns(r.runs);
        setError('');
        setLoading(false);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Could not load runs.');
          setLoading(false);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 4000);
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="wk-page">
      <header className="wk-page-heading">
        <div>
          <h1>Runs</h1>
          <p>Follow processing and inspect the output of each workflow.</p>
        </div>
        <Button variant="outline" onClick={onWorkflows}>
          Open workflows
        </Button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Loading runs…</p>
      ) : !runs.length ? (
        <section className="wk-dataset-empty">
          <h2>No runs yet</h2>
          <p>Start a test from the workflow editor.</p>
        </section>
      ) : (
        <div className="wk-run-history">
          {runs.map(run => {
            const snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot,
              active = run.queued + run.leased > 0;
            return (
              <button key={run.id} onClick={() => onRun(run.id)}>
                <span>
                  <strong>{run.name}</strong>
                  <small>
                    {new Date(run.created_at).toLocaleString()} · {snapshot.mode === 'test' ? 'Test' : 'Full run'}
                  </small>
                </span>
                <span>
                  {active
                    ? run.leased
                      ? 'Running'
                      : 'Queued'
                    : run.failed
                      ? 'Failed'
                      : run.cancelled
                        ? 'Cancelled'
                        : run.expired
                          ? 'Expired'
                          : 'Complete'}
                  <small>
                    {run.completed} / {run.total} inputs processed
                  </small>
                </span>
                <ArrowUpRight />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
