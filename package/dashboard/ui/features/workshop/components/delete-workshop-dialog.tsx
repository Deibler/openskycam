import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../components/ui/dialog';
import type { WorkshopDeletionPreview } from '../../../../src/models/workshopDeletionInferencemodel';
import type { WorkshopDeletionDialogProps } from '../models/deletionInferencemodel';

export function DeleteWorkshopDialog({ target, onPrepare, onDelete, onClose }: WorkshopDeletionDialogProps) {
  const [preview, setPreview] = useState<WorkshopDeletionPreview | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    let ignore = false;
    setPreview(null);
    setError('');
    void onPrepare(target.kind, target.id)
      .then(value => {
        if (!ignore) setPreview(value);
      })
      .catch(error => {
        if (!ignore) setError(error instanceof Error ? error.message : 'Could not check this item.');
      });
    return () => {
      ignore = true;
    };
  }, [target.kind, target.id, onPrepare, attempt]);
  async function remove() {
    if (!preview || submitting.current) return;
    submitting.current = true;
    setDeleting(true);
    setError('');
    try {
      await onDelete(target.kind, target.id, preview.revision);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Deletion failed. Please try again.');
    } finally {
      submitting.current = false;
      setDeleting(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        className="wk-dialog wk-delete-dialog"
        showCloseButton={!deleting}
        onOpenAutoFocus={event => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogTitle>Delete {target.kind}?</DialogTitle>
        <p className="wk-delete-name">{preview?.name || target.name}</p>
        <DialogDescription>
          {target.kind === 'workflow'
            ? 'This permanently removes the workflow. Its output buckets and completed results stay available.'
            : 'This permanently removes the bucket, its labels, and dataset versions, including saved items. Original camera footage and images used by other buckets are kept.'}
        </DialogDescription>
        {!preview && !error && <p role="status">Checking what’s affected…</p>}
        {preview && (
          <>
            {target.kind === 'bucket' && (
              <dl className="wk-delete-counts">
                <div>
                  <dt>Images</dt>
                  <dd>
                    {preview.images.toLocaleString()}
                    {preview.saved_images > 0 && <small>{preview.saved_images.toLocaleString()} saved</small>}
                  </dd>
                </div>
                <div>
                  <dt>Dataset versions</dt>
                  <dd>{preview.versions.toLocaleString()}</dd>
                </div>
              </dl>
            )}
            {preview.linked_workflows.length > 0 && (
              <div className="wk-delete-dependencies">
                <p>
                  {preview.linked_workflows.length === 1 ? 'This workflow will' : 'These workflows will'} need a
                  replacement bucket:
                </p>
                <ul>
                  {preview.linked_workflows.map(w => (
                    <li key={w.id}>{w.name || 'Untitled workflow'}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="wk-delete-runs">
              {preview.active_runs
                ? `${preview.active_runs} unfinished ${preview.active_runs === 1 ? 'run will' : 'runs will'} be cancelled.`
                : 'Any unfinished runs will be cancelled.'}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="wk-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancel} variant="outline" disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          {!preview && error ? (
            <Button variant="secondary" onClick={() => setAttempt(n => n + 1)}>
              Try again
            </Button>
          ) : (
            <Button variant="destructive" disabled={!preview || deleting} onClick={() => void remove()}>
              {deleting ? 'Deleting…' : `Delete ${target.kind}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
