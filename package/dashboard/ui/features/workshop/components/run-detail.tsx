import { ArrowLeft } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useWorkshopRun } from '../hooks/use-workshop-run';
import type { RunDetailProps } from '../models/runInferencemodel';
import { RunOutput } from './run-output';
import { RunSightings } from './run-sightings';
export function RunDetail({ id, onBack, onWorkflow, onBucket, onReview }: RunDetailProps) {
  const monitor = useWorkshopRun(id);
  return (
    <div className="wk-page wk-run-page">
      <Button
        className="wk-run-back"
        variant="ghost"
        onClick={() => (monitor.run ? onWorkflow(monitor.run.workflow_id) : onBack())}
      >
        <ArrowLeft />
        {monitor.run ? 'Workflow' : 'All runs'}
      </Button>
      <header className="wk-page-heading">
        <div>
          <span className="wk-eyebrow">{monitor.run?.mode === 'test' ? 'Test run' : 'Workflow run'}</span>
          <h1>{monitor.run?.name ?? 'Run details'}</h1>
          {monitor.run && <p>Started {new Date(monitor.run.created_at).toLocaleString()}</p>}
        </div>
      </header>
      <RunOutput
        {...monitor}
        onRefresh={monitor.refresh}
        onCancel={() => void monitor.cancel()}
        onBucket={onBucket}
        results={
          monitor.run?.mode === 'run' ? (
            <RunSightings runId={id} version={monitor.run.processed_images} onReview={onReview} />
          ) : undefined
        }
      />
    </div>
  );
}
