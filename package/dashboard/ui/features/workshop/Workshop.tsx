import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api-request';
import type { RunRequest } from './models/runInferencemodel';
import { DeleteWorkshopDialog } from './components/delete-workshop-dialog';
import type { WorkshopDeletionTarget } from './models/deletionInferencemodel';
import { RunDetail } from './components/run-detail';
import { RunList } from './components/run-list';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { LoadingStatus } from '../../components/brand-indicator';
import { useWorkshopDrafts } from './hooks/use-workshop-drafts';
import { useWorkshopRoute } from './hooks/use-workshop-route';
import { useWorkshopCatalog } from './hooks/use-workshop-catalog';
import { WorkshopShell } from './components/workshop-shell';
import { WorkshopOverview } from './components/workshop-overview';
import { WorkflowDetail } from './components/workflow-detail';
import { RunReview } from './components/run-review';
import { usePolled } from './hooks/use-polled';
import { usesTracking } from './service/workflowInferenceService';
import type { WorkshopRunStatus, WorkshopSummary } from '../../../src/models/workshopInferencemodel';
import { BucketList } from './components/bucket-list';
import { BucketWorkspace } from './components/bucket-workspace';
import '@xyflow/react/dist/style.css';
import './styles/workshop.css';
import './styles/conditions.css';
import './styles/buckets.css';
import './styles/runs.css';
import './styles/review.css';
import './styles/browser.css';
import './styles/reviewer.css';

const WorkflowEditor = lazy(() =>
  import('./components/workflow-editor').then(module => ({ default: module.WorkflowEditor })),
);
const ModelLibrary = lazy(() =>
  import('../../components/model-library').then(module => ({ default: module.ModelLibrary })),
);

export default function Workshop({
  theme,
  onTheme,
  onExit: exitWorkshop,
}: {
  theme: string;
  onTheme: () => void;
  onExit: (view: 'recordings' | 'activity' | 'api') => void;
}) {
  const drafts = useWorkshopDrafts();
  const [editState, setEditState] = useState({ dirty: false, busy: false });
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const onEditState = useCallback((dirty: boolean, busy: boolean) => setEditState({ dirty, busy }), []);
  function leaveDetection(action: () => void) {
    if (editState.busy) return;
    if (editState.dirty) setPendingNavigation(() => action);
    else action();
  }
  const onExit = (view: 'recordings' | 'activity' | 'api') => leaveDetection(() => exitWorkshop(view));
  const [deleting, setDeleting] = useState<WorkshopDeletionTarget | null>(null);
  function confirmDelete(kind: WorkshopDeletionTarget['kind'], id: string) {
    const item = (kind === 'workflow' ? drafts.workflows : drafts.buckets).find(item => item.id === id);
    if (item) setDeleting({ kind, id, name: item.name });
  }
  const { route, navigate: navigateRoute } = useWorkshopRoute();
  const navigate: typeof navigateRoute = (...args) =>
    args[3] ? navigateRoute(...args) : leaveDetection(() => navigateRoute(...args));
  const catalog = useWorkshopCatalog();
  const workflow = drafts.workflows.find(workflow => workflow.id === route.id);
  // Old dataset deep links used a workflow ID. Resolve them to its migrated output bucket.
  const legacyOutput = workflow?.nodes.find(node => node.data.kind === 'output')?.data;
  const bucket =
    drafts.buckets.find(bucket => bucket.id === route.id) ??
    (legacyOutput?.kind === 'output' ? drafts.buckets.find(bucket => bucket.id === legacyOutput.bucketId) : undefined);
  // Counts behind the overview and bucket pages; the editor and review pages do not need them.
  const summary = usePolled<WorkshopSummary>(
    drafts.ready && ['overview', 'workflow', 'buckets'].includes(route.page) ? '/api/workshop/summary' : null,
    20000,
  );
  const title =
    (route.page === 'editor' || route.page === 'workflow') && workflow
      ? workflow.name
      : route.page === 'bucket' && bucket
        ? bucket.name
        : {
            overview: 'Overview',
            workflow: 'Workflow',
            editor: 'Workflow',
            buckets: 'Buckets',
            bucket: 'Bucket',
            models: 'Model library',
            runs: 'Runs',
            run: 'Run details',
            review: 'Review sightings',
          }[route.page];
  useEffect(() => {
    document.title = `${title} · Workshop · openskycam`;
  }, [title]);
  async function runWorkflow(request: RunRequest) {
    if (!workflow) throw new Error('Workflow not found.');
    const revision = await drafts.save();
    const { runtimes } = await apiRequest<{
      runtimes: { id: string; last_seen_at: string | null; capabilities?: string[] }[];
    }>('/api/workshop/runtimes');
    const tracking = usesTracking(workflow);
    const runtime = runtimes.find(
      r =>
        (request.mode !== 'test' || r.capabilities?.includes('test-runs')) &&
        (!tracking || r.capabilities?.includes('tracking')) &&
        r.last_seen_at &&
        Date.now() - Date.parse(r.last_seen_at) < 120000,
    );
    if (!runtime)
      throw new Error(
        'A compatible Workshop processor is not online yet. Start the current runner on the processor, then try again.',
      );
    const id = crypto.randomUUID();
    await apiRequest('/api/workshop/runs', 'POST', {
      id,
      workflow_id: workflow.id,
      runtime_id: runtime.id,
      revision,
      ...request,
    });
    if (request.mode !== 'test') navigate('run', id);
    return id;
  }
  /** Opens the newest run of a workflow with photos to review, or the workflow when none has any. */
  async function reviewWorkflow(id: string, replace = false) {
    const runs = await apiRequest<{ runs: WorkshopRunStatus[] }>(
      `/api/workshop/runs?workflow=${encodeURIComponent(id)}`,
    ).then(
      r => r.runs,
      () => [],
    );
    const run = runs.find(r => r.pending > 0);
    navigate(run ? 'review' : 'workflow', run?.id ?? id, '', replace);
  }
  // Back from a review returns to the Workshop page that opened it; a review opened from a link goes to the overview.
  const back = () => leaveDetection(() => (history.state?.workshop ? history.back() : navigateRoute('overview')));
  if (!drafts.ready)
    return (
      <WorkshopShell
        page={route.page}
        title={title}
        theme={theme}
        onTheme={onTheme}
        onNavigate={navigate}
        onExit={onExit}
      >
        {drafts.error ? (
          <div className="wk-page">
            <p role="alert">{drafts.error}</p>
            <Button onClick={() => window.location.reload()}>Reconnect</Button>
          </div>
        ) : (
          <LoadingStatus className="wk-loading">Opening Workshop…</LoadingStatus>
        )}
      </WorkshopShell>
    );
  return (
    <WorkshopShell
      page={route.page}
      title={title}
      theme={theme}
      onTheme={onTheme}
      onNavigate={navigate}
      onExit={onExit}
    >
      {(drafts.error || catalog.error) && (
        <div className="wk-notice" role="alert">
          {drafts.error || catalog.error}
          {catalog.error && (
            <Button variant="ghost" onClick={catalog.retry}>
              Retry
            </Button>
          )}
        </div>
      )}
      {route.page === 'overview' && (
        <WorkshopOverview
          workflows={drafts.workflows}
          buckets={drafts.buckets}
          catalog={catalog}
          summary={summary.data}
          onCreate={name => {
            const workflow = drafts.create(name);
            navigate('editor', workflow.id);
          }}
          onOpen={id => navigate('workflow', id)}
          onReview={id => void reviewWorkflow(id)}
          onBucket={id => navigate('bucket', id)}
        />
      )}
      {route.page === 'workflow' && workflow && (
        <WorkflowDetail
          key={workflow.id}
          workflow={workflow}
          workflows={drafts.workflows}
          buckets={drafts.buckets}
          catalog={catalog}
          summary={summary.data}
          theme={theme === 'dark' ? 'dark' : 'light'}
          onBack={() => navigate('overview')}
          onEdit={() => navigate('editor', workflow.id)}
          onDelete={() => confirmDelete('workflow', workflow.id)}
          onRun={id => navigate('run', id)}
          onReview={id => navigate('review', id)}
          onReviewAll={() => void reviewWorkflow(workflow.id)}
          onBucket={id => navigate('bucket', id)}
        />
      )}
      {route.page === 'editor' && workflow && (
        <Suspense fallback={<LoadingStatus className="wk-loading">Loading editor…</LoadingStatus>}>
          <WorkflowEditor
            onDelete={() => confirmDelete('workflow', workflow.id)}
            key={workflow.id}
            workflow={workflow}
            workflows={drafts.workflows}
            buckets={drafts.buckets}
            catalog={catalog}
            theme={theme === 'dark' ? 'dark' : 'light'}
            saving={drafts.saving}
            saveFailed={drafts.saveFailed}
            onRun={runWorkflow}
            onOpenRun={id => navigate('run', id)}
            onUpdate={mutation => drafts.update(workflow.id, mutation)}
            onBack={() => navigate('workflow', workflow.id)}
            onCreateBucket={drafts.addBucket}
            onOpenBucket={id => navigate('bucket', id)}
          />
        </Suspense>
      )}
      {route.page === 'bucket' && bucket && (
        <BucketWorkspace
          onEditState={onEditState}
          onLeave={leaveDetection}
          onDelete={() => leaveDetection(() => confirmDelete('bucket', bucket.id))}
          key={bucket.id}
          bucket={bucket}
          workflows={drafts.workflows}
          catalog={catalog}
          onBack={() => navigate('buckets')}
          onWorkflow={id => navigate('editor', id)}
          onCreateWorkflow={(name, bucketId) =>
            leaveDetection(() => {
              const workflow = drafts.create(name, bucketId);
              navigateRoute('editor', workflow.id);
            })
          }
          onEdit={(name, description) => drafts.editBucket(bucket.id, name, description)}
          onRecordings={() => onExit('recordings')}
          itemId={route.item}
          onItem={(item, visit) => navigate('bucket', route.id, item, !visit)}
        />
      )}
      {(((route.page === 'editor' || route.page === 'workflow') && !workflow) ||
        (route.page === 'bucket' && !bucket)) && (
        <section className="wk-dataset-empty">
          <h1>{route.page === 'bucket' ? 'Bucket' : 'Workflow'} not found</h1>
          <p>It may have been deleted. Open another from the Workshop.</p>
          <Button variant="outline" onClick={() => navigate(route.page === 'bucket' ? 'buckets' : 'overview')}>
            Open {route.page === 'bucket' ? 'buckets' : 'the overview'}
          </Button>
        </section>
      )}
      {route.page === 'buckets' && (
        <BucketList
          onDelete={id => confirmDelete('bucket', id)}
          buckets={drafts.buckets}
          workflows={drafts.workflows}
          summary={summary.data}
          onOpen={id => navigate('bucket', id)}
          onCreate={drafts.addBucket}
        />
      )}
      {route.page === 'models' && (
        <Suspense fallback={<LoadingStatus className="wk-loading">Loading model library…</LoadingStatus>}>
          <ModelLibrary embedded onKeys={() => onExit('api')} />
        </Suspense>
      )}
      {route.page === 'run' && (
        <RunDetail
          key={route.id}
          id={route.id}
          onBack={() => navigate('runs')}
          onWorkflow={id => navigate('workflow', id)}
          onBucket={id => navigate('bucket', id)}
          onReview={item => navigate('review', route.id, item)}
        />
      )}
      {route.page === 'review' && (
        <RunReview
          onEditState={onEditState}
          key={route.id}
          runId={route.id}
          itemId={route.item}
          buckets={drafts.buckets}
          workflows={drafts.workflows}
          onItem={item => navigate('review', route.id, item, true)}
          onNext={next =>
            next.kind === 'run' ? navigate('review', next.id, '', true) : void reviewWorkflow(next.id, true)
          }
          onBack={back}
        />
      )}
      {route.page === 'runs' && <RunList onRun={id => navigate('run', id)} onWorkflows={() => navigate('overview')} />}
      <Dialog
        open={pendingNavigation !== null}
        onOpenChange={open => {
          if (!open) setPendingNavigation(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Discard unsaved edits?</DialogTitle>
          <DialogDescription>
            Save your detection changes before leaving, or discard them to continue.
          </DialogDescription>
          <Button variant="outline" onClick={() => setPendingNavigation(null)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              setEditState({ dirty: false, busy: false });
              setPendingNavigation(null);
              pendingNavigation?.();
            }}
          >
            Discard and continue
          </Button>
        </DialogContent>
      </Dialog>
      {deleting && (
        <DeleteWorkshopDialog
          key={`${deleting.kind}/${deleting.id}`}
          target={deleting}
          onPrepare={drafts.prepareDeletion}
          onDelete={async (kind, id, revision) => {
            await drafts.remove(kind, id, revision);
            if (route.id === id && (route.page === 'editor' || route.page === 'workflow' || route.page === 'bucket'))
              navigate(kind === 'workflow' ? 'overview' : 'buckets');
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </WorkshopShell>
  );
}
