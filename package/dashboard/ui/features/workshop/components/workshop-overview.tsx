import { useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, Layers, PlayCircle, Plus, Search } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { CreateWorkflowDialog } from './create-workflow-dialog';
import { DailyChart } from './workflow-stats';
import { validateWorkflow } from '../service/workflowInferenceService';
import { runState, runStateLabel, when, workflowFacts } from '../utils/overviewInferenceUtil';
import { scheduleSummary, workflowSchedule } from '../utils/scheduleInferenceUtil';
import type { WorkshopSummary } from '../../../../src/models/workshopInferencemodel';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkshopCatalog } from '../models/workflowInferencemodel';

const filters = [
  ['all', 'All'],
  ['review', 'Needs review'],
  ['scheduled', 'Scheduled'],
  ['active', 'Running'],
  ['setup', 'Needs setup'],
] as const;
type Filter = (typeof filters)[number][0];

/** Every workflow as a card: what it reads, the buckets it fills, its last run, and a way into what is waiting for review. */
export function WorkshopOverview({
  workflows,
  buckets,
  catalog,
  summary,
  onOpen,
  onReview,
  onBucket,
  onCreate,
}: {
  workflows: WorkflowDraft[];
  buckets: WorkshopBucket[];
  catalog: WorkshopCatalog;
  summary: WorkshopSummary | null;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
  onBucket: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState<Filter>('all');
  const cards = useMemo(
    () =>
      workflows.map(workflow => {
        const stats = summary?.workflows.find(item => item.workflow_id === workflow.id);
        const facts = workflowFacts(workflow, buckets, catalog.models);
        const schedule = workflowSchedule(workflow);
        const issues = catalog.loading ? [] : validateWorkflow(workflow, catalog.models, buckets, workflows);
        const run = stats?.last_run ?? null;
        const state = run ? runState(run) : null;
        const tags = new Set<Filter>(['all']);
        if (stats?.pending) tags.add('review');
        if (schedule) tags.add('scheduled');
        if (state === 'running' || state === 'queued') tags.add('active');
        if (issues.length) tags.add('setup');
        return { workflow, stats, facts, schedule, issues, run, state, tags };
      }),
    [workflows, buckets, catalog, summary],
  );
  const text = query.trim().toLowerCase();
  const shown = cards.filter(
    card =>
      card.tags.has(filter) &&
      (!text ||
        [card.workflow.name, card.facts.input, ...card.facts.models, ...card.facts.outputs.map(o => o.name)].some(
          value => value.toLowerCase().includes(text),
        )),
  );
  const counts = (key: Filter) => cards.filter(card => card.tags.has(key)).length;
  return (
    <div className="wk-page wk-overview">
      <header className="wk-page-heading">
        <div>
          <h1>Overview</h1>
          <p>Each workflow finds sightings in your footage. Review them to keep the real ones.</p>
        </div>
        <Button className="wk-primary" onClick={() => setCreating(true)}>
          <Plus />
          Create workflow
        </Button>
      </header>
      {workflows.length ? (
        <>
          <div className="wk-overview-filters">
            <label className="wk-search">
              <Search />
              <Input
                type="search"
                aria-label="Search workflows and buckets"
                placeholder="Find a workflow or bucket"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </label>
            <div role="group" aria-label="Show workflows">
              {filters.map(([key, label]) => (
                <Button key={key} variant="ghost" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}
                  <span>{counts(key)}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="wk-overview-grid">
            {shown.map(({ workflow, stats, facts, schedule, issues, run, state }) => (
              <article key={workflow.id} className="wk-workflow-card">
                <header>
                  <h2>
                    <button type="button" className="wk-card-link" onClick={() => onOpen(workflow.id)}>
                      {workflow.name || 'Untitled workflow'}
                    </button>
                  </h2>
                  <span
                    className="wk-card-state"
                    data-state={issues.length ? 'setup' : state === 'running' || state === 'queued' ? 'active' : 'idle'}
                  >
                    {issues.length
                      ? 'Needs setup'
                      : state === 'running'
                        ? 'Running'
                        : state === 'queued'
                          ? 'Queued'
                          : schedule
                            ? 'Scheduled'
                            : 'Manual'}
                  </span>
                </header>
                <p className="wk-card-source">
                  {schedule && (
                    <>
                      <CalendarClock aria-hidden="true" />
                      {scheduleSummary(schedule, workflows)} ·{' '}
                    </>
                  )}
                  {facts.input}
                  {facts.models.length > 0 && ` → ${facts.models.join(', ')}`}
                </p>
                <dl className="wk-card-stats">
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
                    <dt>Runs</dt>
                    <dd>{(stats?.runs ?? 0).toLocaleString()}</dd>
                  </div>
                </dl>
                {!!stats?.pending && (
                  <Button className="wk-card-review" onClick={() => onReview(workflow.id)}>
                    <PlayCircle />
                    Review {stats.pending.toLocaleString()}
                  </Button>
                )}
                {!!stats?.daily.length && <DailyChart daily={stats.daily} compact />}
                <ul className="wk-card-buckets" aria-label={`Buckets ${workflow.name} writes to`}>
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
                          <span className="wk-card-bucket-count">{(counts?.images ?? 0).toLocaleString()} images</span>
                          <ArrowRight aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <footer>
                  {run ? (
                    <>
                      Last run {when(run.created_at)} · {runStateLabel[state!]}
                      {run.images ? ` · ${run.images} ${run.images === 1 ? 'sighting' : 'sightings'}` : ''}
                    </>
                  ) : (
                    (issues[0]?.message ?? 'Not run yet')
                  )}
                </footer>
              </article>
            ))}
          </div>
          {!shown.length && <p className="wk-empty-search">No workflows match. Clear the search or choose All.</p>}
        </>
      ) : (
        <section className="wk-welcome">
          <h2>No workflows yet</h2>
          <p>Create a workflow to filter footage, run models, and add labeled images to reusable buckets.</p>
        </section>
      )}
      <CreateWorkflowDialog open={creating} onOpenChange={setCreating} onCreate={onCreate} />
    </div>
  );
}
