import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';

export function CreateWorkflowDialog({
  open,
  onOpenChange,
  onCreate,
  source = 'Camera archive',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
  source?: string;
}) {
  const [name, setName] = useState(''),
    [error, setError] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wk-dialog">
        <DialogTitle>Create a workflow</DialogTitle>
        <DialogDescription>Start with {source}. Connect and configure your steps on the canvas.</DialogDescription>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (name.trim()) {
              try {
                onCreate(name.trim());
                onOpenChange(false);
                setName('');
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Unable to create workflow.');
              }
            }
          }}
        >
          <label className="wk-field">
            <span>Workflow name</span>
            <Input
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={100}
              placeholder="e.g. Daytime objects"
            />
          </label>
          <p className="wk-hint wk-form-note">
            A new labeled bucket will hold the output. You can choose a different destination in the editor.
          </p>
          <p role="alert" className="wk-error wk-hint">
            {error}
          </p>
          <Button type="submit" disabled={!name.trim()} className="wk-primary">
            Create workflow
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
