import { useState } from 'react';
import { ArrowUpRight, Check, CircleStop } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { LoadingStatus } from '../../../components/brand-indicator';
import { ReviewFrame } from './review-frame';
import { ImageInspector } from './image-inspector';
import type { WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { RunOutputProps } from '../models/runInferencemodel';

const phases = {
  downloading: 'Downloading source',
  loading_model: 'Loading model',
  processing: 'Processing images',
  uploading: 'Preparing preview',
  finalizing: 'Finishing input',
};
const statuses = {
  queued: 'Waiting for processor',
  running: 'Running',
  completed: 'Complete',
  failed: 'Finished with errors',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
export function RunOutput({ run, error, compact, results, onCancel, onRefresh, onOpen, onBucket }: RunOutputProps) {
  const [inspected, setInspected] = useState<WorkshopRunImage | null>(null);
  const active = run && ['queued', 'running'].includes(run.status);
  // Several recordings run at once. Prefer one that is on a workflow step over one still downloading.
  const leased = run?.jobs.filter(j => j.status === 'leased') ?? [];
  const working = leased.find(j => j.progress?.node_id) ?? leased[0];
  const steps =
    run?.steps ??
    run?.workflow.nodes.map(n => ({ id: n.id, kind: String(n.data.kind), label: String(n.data.label) })) ??
    [];
  const node = steps.find(n => n.id === working?.progress?.node_id);
  return (
    <div className="wk-run-output" data-compact={compact || undefined}>
      {error && (
        <div role="alert" className="wk-error">
          {error}
          <Button variant="ghost" onClick={onRefresh}>
            Retry
          </Button>
        </div>
      )}
      {!run ? (
        !error && <LoadingStatus>Connecting to run…</LoadingStatus>
      ) : (
        <>
          <section className="wk-run-progress" aria-label="Run progress">
            <div className="wk-run-status" role="status">
              {run.status === 'completed' && <Check />}
              <strong>{statuses[run.status]}</strong>
              {onOpen && (
                <Button size="icon" variant="ghost" aria-label="Open run details" onClick={onOpen}>
                  <ArrowUpRight />
                </Button>
              )}
            </div>
            <div className="wk-run-count">
              <strong style={{ minWidth: `${run.expected_images.toLocaleString().length}ch` }}>
                {run.processed_images.toLocaleString()}
              </strong>
              <span>/ {run.expected_images.toLocaleString()} images</span>
            </div>
            <progress
              aria-label="Images processed"
              value={run.processed_images}
              max={Math.max(run.expected_images, 1)}
            />
            {active && (
              <p className="wk-run-stage">
                {working?.progress ? phases[working.progress.phase] : working ? 'Preparing input' : '\u00a0'}
                <span>{node?.label ?? '\u00a0'}</span>
              </p>
            )}
            {run.requested_images && run.expected_images < run.requested_images && (
              <p>Only {run.expected_images} images are available in the selected input.</p>
            )}
            {run.mode === 'test' && (
              <p className="wk-test-retention">
                {run.status === 'expired'
                  ? 'Test images and labels have expired.'
                  : `Temporary preview · expires at ${new Date(run.preview_expires_at!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}{' '}
                No results are added to buckets or datasets.
              </p>
            )}
            {active && (
              <Button variant="outline" onClick={onCancel}>
                <CircleStop />
                Cancel {run.mode === 'test' ? 'test' : 'run'}
              </Button>
            )}
          </section>

          {run.jobs.some(j => j.error || ['cancelled', 'expired'].includes(j.status)) && (
            <section className="wk-run-issues">
              <h2>Processing details</h2>
              {run.jobs.map((j, i) =>
                j.error || ['cancelled', 'expired'].includes(j.status) ? (
                  <p key={j.id}>
                    Input {i + 1}: {j.error ? j.error.replaceAll('_', ' ') : j.status}. {j.processed} of {j.expected}{' '}
                    images processed.
                  </p>
                ) : null,
              )}
            </section>
          )}
          {results ?? (
            <section className="wk-run-results">
              <header>
                <h2>{run.mode === 'test' ? 'Test output' : 'Latest output'}</h2>
                <span>
                  {run.images.length} {run.has_more ? 'shown' : 'images'}
                </span>
              </header>
              {run.images.length ? (
                <div className="wk-image-grid">
                  {run.images.map(item => (
                    <ReviewFrame
                      key={item.id}
                      item={item}
                      imageUrl={item.image_url}
                      temporary={run.mode === 'test' || item.image_url.includes('/previews/')}
                      onInspect={() => setInspected(item)}
                    />
                  ))}
                </div>
              ) : (
                <p className="wk-run-empty">
                  {active
                    ? 'Finished images will appear here as they arrive.'
                    : run.status === 'expired'
                      ? 'Run another test to see fresh results.'
                      : 'No images were produced.'}
                </p>
              )}
              {!!run.output_buckets.length && onBucket && (
                <div className="wk-run-bucket-links">
                  {run.output_buckets.map(id => (
                    <Button key={id} variant="outline" onClick={() => onBucket(id)}>
                      Review output bucket
                      <ArrowUpRight />
                    </Button>
                  ))}
                </div>
              )}
            </section>
          )}

          {!compact && (
            <section className="wk-run-steps" aria-label="Workflow steps">
              <h2>Workflow</h2>
              <div>
                {steps.map(n => (
                  <div key={n.id} data-active={(active && node?.id === n.id) || undefined}>
                    <small>{n.kind}</small>
                    <strong>{n.label}</strong>
                    <span>Active</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {inspected && run?.status !== 'expired' && (
        <ImageInspector
          key={inspected.id}
          item={inspected}
          imageUrl={inspected.image_url}
          onClose={() => setInspected(null)}
        />
      )}
    </div>
  );
}
