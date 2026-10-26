import { useState } from 'react';
import { ArrowRight, Database, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { BucketForm } from './bucket-form';
import { bucketUsage } from '../service/bucketInferenceService';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft } from '../models/workflowInferencemodel';
import type { WorkshopSummary } from '../../../../src/models/workshopInferencemodel';
import { when } from '../utils/overviewInferenceUtil';

export function BucketList({
  buckets,
  workflows,
  summary,
  onOpen,
  onCreate,
  onDelete,
}: {
  buckets: WorkshopBucket[];
  workflows: WorkflowDraft[];
  summary: WorkshopSummary | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string, description: string) => WorkshopBucket;
}) {
  const [creating, setCreating] = useState(false),
    [query, setQuery] = useState('');
  const archive = buckets.find(bucket => bucket.kind === 'raw');
  const labeled = buckets.filter(bucket => bucket.kind === 'labeled');
  const filtered = labeled.filter(bucket =>
    `${bucket.name} ${bucket.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="wk-page wk-buckets-page">
      <header className="wk-page-heading">
        <div>
          <h1>Buckets</h1>
          <p>Your source video and labeled images, ready to use in any workflow.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          Create bucket
        </Button>
      </header>
      {archive && (
        <button type="button" className="wk-archive-bucket" onClick={() => onOpen(archive.id)}>
          <Database aria-hidden="true" />
          <span>
            <small>Raw video</small>
            <strong>{archive.name}</strong>
            <span>{archive.description}</span>
          </span>
          <ArrowRight aria-hidden="true" />
        </button>
      )}
      <section className="wk-labeled-buckets" aria-label="Labeled buckets">
        <header>
          <div>
            <h2>Labeled buckets</h2>
            <p>Workflow outputs that can become your next input.</p>
          </div>
          {labeled.length > 0 && (
            <label className="wk-search">
              <Search />
              <Input
                type="search"
                aria-label="Search buckets"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Find a bucket"
              />
            </label>
          )}
        </header>
        {labeled.length ? (
          <ul className="wk-bucket-list">
            {filtered.map(bucket => {
              const usage = bucketUsage(bucket.id, workflows);
              const writers = usage.writes
                .map(id => workflows.find(workflow => workflow.id === id)?.name)
                .filter(Boolean);
              const counts = summary?.buckets.find(item => item.bucket_id === bucket.id);
              return (
                <li key={bucket.id} className="wk-bucket-list-entry">
                  <button
                    type="button"
                    className="wk-bucket-list-row"
                    onClick={() => onOpen(bucket.id)}
                    aria-label={`Open ${bucket.name}`}
                  >
                    <span>
                      <strong>{bucket.name}</strong>
                      <small className="wk-bucket-source">
                        {writers.length
                          ? `From ${writers.join(', ')}`
                          : usage.reads.length
                            ? 'Read by a workflow; nothing writes to it'
                            : 'No workflow yet'}
                      </small>
                      <small>{bucket.description || 'Ready for labeled images'}</small>
                    </span>
                    <span className="wk-bucket-usage">
                      <strong>{(counts?.images ?? 0).toLocaleString()} images</strong>
                      {counts?.pending ? <span data-attention>{counts.pending.toLocaleString()} to review</span> : null}
                      <span>
                        {counts?.last_added_at ? `Last added ${when(counts.last_added_at)}` : 'Nothing added yet'}
                      </span>
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </button>
                  <Button
                    className="wk-delete-action"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${bucket.name}`}
                    title="Delete bucket"
                    onClick={() => onDelete(bucket.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
            {!filtered.length && <li className="wk-empty-search">No buckets match that search.</li>}
          </ul>
        ) : (
          <div className="wk-bucket-intro">
            <h3>A place for what your workflows find.</h3>
            <p>
              Create a bucket, then choose it as a workflow’s output. Use that same bucket as an input to refine labels
              or run another model.
            </p>
          </div>
        )}
      </section>
      <p className="wk-local-note">Buckets reference the shared archive. Images inherit their source expiration.</p>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="wk-dialog">
          <DialogTitle>New labeled bucket</DialogTitle>
          <DialogDescription>
            Name the images and labels you want to gather. You can connect a workflow afterward.
          </DialogDescription>
          <BucketForm
            onSubmit={(name, description) => {
              const bucket = onCreate(name, description);
              setCreating(false);
              onOpen(bucket.id);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
