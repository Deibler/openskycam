import type { WorkshopRunStatus, WorkshopSummary } from '../../../../src/models/workshopInferencemodel';
import type { NextReview } from '../models/reviewInferencemodel';
import type { WorkflowDraft } from '../models/workflowInferencemodel';
import { usePolled } from './use-polled';

/** Where to go after a run's feed: the workflow's next run with photos to review, else the next workflow with some. */
export function useNextReview(
  workflowId: string | undefined,
  runId: string,
  workflows: WorkflowDraft[],
): NextReview | null {
  const runs = usePolled<{ runs: WorkshopRunStatus[] }>(
    workflowId ? `/api/workshop/runs?workflow=${encodeURIComponent(workflowId)}` : null,
    60000,
  );
  const summary = usePolled<WorkshopSummary>(workflowId ? '/api/workshop/summary' : null, 60000);
  const run = runs.data?.runs.find(r => r.id !== runId && r.pending > 0);
  if (run) return { kind: 'run', id: run.id, name: 'Next run', pending: run.pending };
  const pending = new Map(summary.data?.workflows.map(s => [s.workflow_id, s.pending]));
  const workflow = workflows.find(w => w.id !== workflowId && pending.get(w.id));
  return workflow
    ? {
        kind: 'workflow',
        id: workflow.id,
        name: workflow.name || 'Untitled workflow',
        pending: pending.get(workflow.id)!,
      }
    : null;
}
