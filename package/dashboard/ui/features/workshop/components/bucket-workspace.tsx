import { useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Database, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { DatasetVersions } from './dataset-versions';
import { BucketExplorer } from './bucket-explorer';
import { BucketForm } from './bucket-form';
import { CreateWorkflowDialog } from './create-workflow-dialog';
import { bucketUsage } from '../service/bucketInferenceService';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkshopCatalog } from '../models/workflowInferencemodel';

export function BucketWorkspace({
  bucket,
  workflows,
  catalog,
  onBack,
  onWorkflow,
  onCreateWorkflow,
  onEdit,
  onRecordings,
  onDelete,
  itemId,
  onItem,
  onEditState,
  onLeave = action => action(),
}: {
  onEditState?: (dirty: boolean, busy: boolean) => void;
  onLeave?: (action: () => void) => void;
  itemId?: string;
  onItem?: (id: string, visit?: boolean) => void;
  bucket: WorkshopBucket;
  workflows: WorkflowDraft[];
  catalog: WorkshopCatalog;
  onBack: () => void;
  onWorkflow: (id: string) => void;
  onCreateWorkflow: (name: string, bucketId: string) => void;
  onEdit: (name: string, description: string) => void;
  onRecordings: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState('contents'),
    [editing, setEditing] = useState(false),
    [creating, setCreating] = useState(false);
  const usage = bucketUsage(bucket.id, workflows);
  const raw = bucket.kind === 'raw';
  return (
    <div className={raw ? 'wk-page wk-bucket-page' : 'wk-library-page'}>
      <header className="wk-library-heading">
        <Button variant="ghost" className="wk-back" onClick={onBack}>
          <ArrowLeft />
          Buckets
        </Button>
        <div>
          <span className="wk-eyebrow">{raw ? 'Raw video' : 'Labeled images'}</span>
          <h1>{bucket.name}</h1>
          <p>{bucket.description || 'Images and labels gathered by your workflows.'}</p>
        </div>
        <div className="wk-bucket-actions">
          {!raw && (
            <Button variant="ghost" size="icon" aria-label="Edit bucket" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
          )}
          {!raw && (
            <Button
              className="wk-delete-action"
              variant="ghost"
              size="icon"
              aria-label="Delete bucket"
              title="Delete bucket"
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>
            Use in workflow
            <ArrowRight />
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={value => onLeave(() => setTab(value))} className="wk-bucket-tabs">
        <TabsList variant="line" aria-label="Bucket workspace">
          <TabsTrigger value="contents">Contents</TabsTrigger>
          {!raw && <TabsTrigger value="versions">Dataset versions</TabsTrigger>}
          <TabsTrigger value="details">Bucket details</TabsTrigger>
        </TabsList>
        <TabsContent value="contents" className="wk-library-contents">
          {raw ? (
            <section className="wk-bucket-contents">
              <Database />
              <h2>Your camera archive</h2>
              <p>Use a footage filter in your workflow to choose a camera, recorded window, and frame interval.</p>
              {catalog.overview && <p>{catalog.overview.cameras.length} cameras in the archive</p>}
              <Button variant="outline" onClick={onRecordings}>
                Browse recordings
                <ArrowUpRight />
              </Button>
            </section>
          ) : (
            <BucketExplorer
              key={bucket.id}
              bucketId={bucket.id}
              title={bucket.name}
              itemId={itemId}
              onItem={onItem}
              onEditState={onEditState}
              onLeave={onLeave}
            />
          )}
        </TabsContent>
        {!raw && (
          <TabsContent value="versions" className="wk-library-info">
            <DatasetVersions bucketId={bucket.id} />
          </TabsContent>
        )}
        <TabsContent value="details" className="wk-library-info">
          <p className="wk-bucket-retention">
            {raw
              ? 'Original footage follows your archive retention policy.'
              : 'Images and labels expire with their source footage unless explicitly saved.'}
          </p>
          <aside className="wk-bucket-lineage" aria-label="Connected workflows">
            <h2>Connected workflows</h2>
            {(['writes', 'reads'] as const).map(direction => (
              <section key={direction}>
                <h3>{direction === 'writes' ? 'Writing to this bucket' : 'Reading from this bucket'}</h3>
                {usage[direction].length ? (
                  usage[direction].map(id => (
                    <Button variant="ghost" key={id} onClick={() => onWorkflow(id)}>
                      <span>{workflows.find(workflow => workflow.id === id)?.name}</span>
                      <ArrowUpRight />
                    </Button>
                  ))
                ) : (
                  <p>
                    {direction === 'writes' && raw ? 'Camera recordings arrive automatically.' : 'No workflows yet'}
                  </p>
                )}
              </section>
            ))}
          </aside>
        </TabsContent>
      </Tabs>
      <CreateWorkflowDialog
        open={creating}
        onOpenChange={setCreating}
        source={bucket.name}
        onCreate={name => onCreateWorkflow(name, bucket.id)}
      />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="wk-dialog">
          <DialogTitle>Edit bucket</DialogTitle>
          <DialogDescription>The name updates everywhere this bucket is used.</DialogDescription>
          <BucketForm
            name={bucket.name}
            description={bucket.description}
            submitLabel="Save changes"
            onSubmit={(name, description) => {
              onEdit(name, description);
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
