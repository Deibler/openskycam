import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { apiRequest } from '../../../lib/api-request';
import { usePolled } from '../hooks/use-polled';
import type { WorkshopVersionSummary } from '../../../../src/models/workshopInferencemodel';

export function DatasetVersions({ bucketId }: { bucketId: string }) {
  const {
    data,
    error: loadError,
    refresh,
  } = usePolled<{ versions: WorkshopVersionSummary[]; accepted: number }>(
    `/api/workshop/buckets/${encodeURIComponent(bucketId)}`,
    30000,
  );
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="wk-results">
      {(loadError || error) && <p role="alert">{loadError || error}</p>}
      {!data ? (
        <p>Loading versions…</p>
      ) : (
        <>
          <div className="wk-results-toolbar">
            <div>
              <h2>Dataset versions</h2>
              <p>Freeze accepted images, labels, and splits. Source expiration still applies.</p>
            </div>
            <Button
              disabled={!data.accepted || busy}
              onClick={() => {
                setName(`Version ${data.versions.length + 1}`);
                setCreating(true);
              }}
            >
              Create dataset version
            </Button>
          </div>
          {!data.versions.length ? (
            <p className="wk-hint">Accept images in Contents to create your first version.</p>
          ) : (
            <div className="wk-version-list">
              {data.versions.map(version => (
                <article key={version.id}>
                  <div>
                    <h3>{version.name}</h3>
                    <p>
                      {version.images.toLocaleString()} images ·{' '}
                      {new Date(version.created_at).toLocaleString()}
                    </p>
                  </div>
                  <a
                    className="wk-text-link"
                    href={`/api/workshop/versions/${encodeURIComponent(version.id)}`}
                    download={`${version.name}.json`}
                  >
                    Download manifest
                  </a>
                </article>
              ))}
            </div>
          )}
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="wk-dialog">
              <DialogTitle>Create dataset version</DialogTitle>
              <DialogDescription>
                {data.accepted} accepted images. Their labels are frozen. Capture days stay in the same training split.
              </DialogDescription>
              <label className="wk-field">
                Version name
                <Input value={name} onChange={e => setName(e.target.value)} maxLength={100} />
              </label>
              <p className="wk-hint">A version does not save media permanently or restart its expiration.</p>
              {error && <p role="alert">{error}</p>}
              <Button
                disabled={busy || !name.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await apiRequest(`/api/workshop/buckets/${encodeURIComponent(bucketId)}/versions`, 'POST', {
                      id: crypto.randomUUID(),
                      name,
                    });
                    setCreating(false);
                    refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not create version.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Creating…' : 'Create version'}
              </Button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </section>
  );
}
