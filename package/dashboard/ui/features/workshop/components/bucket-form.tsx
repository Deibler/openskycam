import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

export function BucketForm({
  name = '',
  description = '',
  submitLabel = 'Create bucket',
  onSubmit,
  onCancel,
}: {
  name?: string;
  description?: string;
  submitLabel?: string;
  onSubmit: (name: string, description: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(name),
    [note, setNote] = useState(description),
    [error, setError] = useState('');
  return (
    <form
      className="wk-bucket-form"
      onSubmit={event => {
        event.preventDefault();
        try {
          onSubmit(value, note);
        } catch (error) {
          setError(error instanceof Error ? error.message : 'The bucket could not be saved.');
        }
      }}
    >
      <label className="wk-field">
        <span>Bucket name</span>
        <Input
          autoFocus
          value={value}
          maxLength={100}
          placeholder="e.g. Daytime objects"
          onChange={event => {
            setValue(event.target.value);
            setError('');
          }}
        />
      </label>
      <label className="wk-field">
        <span>
          Description <small>(optional)</small>
        </span>
        <Input
          value={note}
          maxLength={300}
          placeholder="What belongs in this bucket?"
          onChange={event => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="wk-error wk-hint">
          {error}
        </p>
      )}
      <div className="wk-bucket-form-actions">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!value.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
