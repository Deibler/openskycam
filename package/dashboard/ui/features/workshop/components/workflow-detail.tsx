import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Layers, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { LoadingStatus } from '../../../components/brand-indicator';
import { ClassTable, DailyChart } from './workflow-stats';
import { usePolled } from '../hooks/use-polled';
import { isTest, runState, runStateLabel, when, workflowFacts } from '../utils/overviewInferenceUtil';
import { scheduleSummary, workflowSchedule } from '../utils/scheduleInferenceUtil';
import type { WorkshopRunStatus, WorkshopSummary } from '../../../../src/models/workshopInferencemodel';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkshopCatalog } from '../models/workflowInferencemodel';

const WorkflowPreview = lazy(() => import('./workflow-preview'));
const runFilters = [
  ['all', 'All runs'],
  ['review', 'Needs review'],
  ['found', 'With sightings'],
] as const;
type RunFilter = (typeof runFilters)[number][0];

/** One workflow: how it is set up, where it writes, how it has done, and every run to review. */
export function WorkflowDetail({
  workflow,
  workflows,
  buckets,
  catalog,
  summary,
  theme,
  onBack,
  onEdit,
  onDelete,
  onRun,
  onReview,
  onReviewAll,
  onBucket,
}: {
  workflow: WorkflowDraft;
  workflows: WorkflowDraft[];
  buckets: WorkshopBucket[];
  catalog: WorkshopCatalog;
  summary: WorkshopSummary | null;
  theme: 'light' | 'dark';
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: (id: string) => void;
  onReview: (id: string) => void;
  onReviewAll: () => void;
  onBucket: (id: string) => void;
}) {
  const runs = usePolled<{ runs: WorkshopRunStatus[] }>(
    `/api/workshop/runs?workflow=${encodeURIComponent(workflow.id)}`,
    10000,
  );
  const [filter, setFilter] = useState<RunFilter>('all');
  const stats = summary?.workflows.find(item => item.workflow_id === workflow.id);
  const facts = workflowFacts(workflow, buckets, catalog.models);
  const schedule = workflowSchedule(workflow);
  const all = runs.data?.runs ?? [];
  const shown = all.filter(run => filter === 'all' || (filter === 'review' ? run.pending > 0 : run.images > 0));
  const reviewed = (stats?.accepted ?? 0) + (stats?.rejected ?? 0);
  return (
    <div className="wk-page wk-workflow-page">
      <Button variant="ghost" className="wk-back" onClick={onBack}>
        <ArrowLeft />
        Overview
      </Button>
      <header className="wk-page-heading">
        <div>
          <span className="wk-eyebrow">
            {schedule ? (
              <>
                <CalendarClock aria-hidden="true" />
                {scheduleSummary(schedule, workflows)}
              </>
            ) : (
              'Runs when you start it'
            )}
          </span>
          <h1>{workflow.name || 'Untitled workflow'}</h1>
          <p>
            {facts.input}
            {facts.models.length > 0 && ` → ${facts.models.join(', ')}`}
          </p>
        </div>
        <div className="wk-bucket-actions">
          <Button
            className="wk-delete-action"
            variant="ghost"
            size="icon"
            aria-label="Delete workflow"
            title="Delete workflow"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
          {stats?.pending ? (
            <>
              <Button variant="outline" onClick={onEdit}>
                <Pencil />
                Edit
              </Button>
              <Button className="wk-primary" onClick={onReviewAll}>
                <PlayCircle />
                Review {stats.pending.toLocaleString()}
              </Button>
            </>
          ) : (
            <Button className="wk-primary" onClick={onEdit}>
              <Pencil />
              Edit workflow
            </Button>
          )}
        </div>
      </header>
      <dl className="wk-kpis">
        <div>
          <dt>Sightings</dt>
          <dd>{(stats?.images ?? 0).toLocaleString()}</dd>
        </div>
        <div data-attention={stats?.pending ? true : undefined}>
          <dt>To review</dt>
          <dd>{(stats?.pending ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Accepted</dt>
          <dd>{(stats?.accepted ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Denied</dt>
          <dd>{(stats?.rejected ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{reviewed ? `${Math.round((stats!.accepted / reviewed) * 100)}%` : '—'}</dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{(stats?.runs ?? 0).toLocaleString()}</dd>
        </div>
      </dl>
      <div className="wk-workflow-grid">
        <section aria-labelledby="workflow-setup">
          <header>
            <h2 id="workflow-setup">Setup</h2>
            <Button variant="ghost" onClick={onEdit}>
              Edit
              <ArrowRight />
            </Button>
          </header>
          <Suspense fallback={<div className="wk-preview" />}>
            <WorkflowPreview
              workflow={workflow}
              workflows={workflows}
              buckets={buckets}
              catalog={catalog}
              theme={theme}
              onBucket={onBucket}
            />
          </Suspense>
        </section>
        <section aria-labelledby="workflow-buckets">
          <h2 id="workflow-buckets">Writes to</h2>
          <ul className="wk-card-buckets">
            {facts.outputs.map(output => {
              const counts = summary?.buckets.find(bucket => bucket.bucket_id === output.bucketId);
              return (
                <li key={output.bucketId || output.name}>
                  <button type="button" disabled={!output.bucketId} onClick={() => onBucket(output.bucketId)}>
                    <Layers aria-hidden="true" />
                    <span>
                      <strong>{output.name}</strong>
                      {output.when && <small>{output.when}</small>}
                    </span>
                    <span className="wk-card-bucket-count">
                      {(counts?.images ?? 0).toLocaleString()} images
                      {counts?.last_added_at ? ` · last ${when(counts.last_added_at)}` : ''}
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <section className="wk-workflow-runs" aria-labelledby="workflow-runs">
        <header>
          <h2 id="workflow-runs">Runs</h2>
          <div role="group" aria-label="Show runs">
            {runFilters.map(([key, label]) => (
              <Button key={key} variant="ghost" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
              </Button>
            ))}
          </div>
        </header>
        {runs.error && (
          <p role="alert" className="wk-error">
            {runs.error}
          </p>
        )}
        {!runs.data ? (
          <LoadingStatus>Loading runs…</LoadingStatus>
        ) : !shown.length ? (
          <p className="wk-run-empty">
            {all.length ? 'No runs match this filter.' : 'No runs yet. Open the editor to test and run this workflow.'}
          </p>
        ) : (
          <div className="wk-table-wrap">
            <table className="wk-table wk-runs-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Recordings</th>
                  <th>Sightings</th>
                  <th>
                    <span className="sr-only">Review</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(run => {
                  const state = runState(run);
                  return (
                    <tr key={run.id}>
                      <td>
                        <button type="button" className="wk-row-link" onClick={() => onRun(run.id)}>
                          <strong>
                            {new Date(run.created_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </strong>
                          <span>
                            {when(run.created_at)}
                            {isTest(run) ? ' · Test' : ''}
                          </span>
                        </button>
                      </td>
                      <td data-state={state}>{runStateLabel[state]}</td>
                      <td>
                        {run.completed} / {run.total}
                        {run.failed ? <small> · {run.failed} failed</small> : null}
                      </td>
                      <td>{run.images.toLocaleString()}</td>
                      <td className="wk-run-review-cell">
                        {run.pending ? (
                          <Button variant="outline" onClick={() => onReview(run.id)}>
                            <PlayCircle />
                            Review {run.pending}
                          </Button>
                        ) : run.images ? (
                          <span>Reviewed</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="wk-workflow-analysis" aria-labelledby="workflow-analysis">
        <h2 id="workflow-analysis">Statistics and analysis</h2>
        <div>
          <DailyChart daily={stats?.daily ?? []} />
          <div>
            <h3>By class</h3>
            <p className="wk-hint">
              Confirmed is the share of reviewed sightings you accepted: how often the model is right.
            </p>
            <div className="wk-table-wrap">
              <ClassTable classes={stats?.classes ?? []} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
