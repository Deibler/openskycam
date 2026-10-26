import { useState } from 'react';
import { Check, Database, Layers, Plus, Search } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { WorkshopBucket } from '../models/bucketInferencemodel';

export function BucketPicker({
  buckets,
  value,
  direction,
  unavailable,
  onChoose,
  onCreate,
}: {
  buckets: WorkshopBucket[];
  value: string;
  direction: 'input' | 'output';
  unavailable: string[];
  onChoose: (id: string) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState('');
  const matches = buckets.filter(
    bucket =>
      (direction === 'input' || bucket.kind === 'labeled') &&
      `${bucket.name} ${bucket.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="wk-bucket-picker">
      <label className="wk-search">
        <Search />
        <Input
          type="search"
          aria-label="Search buckets"
          placeholder="Find a bucket"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </label>
      {(['raw', 'labeled'] as const).map(kind => {
        const group = matches.filter(bucket => bucket.kind === kind);
        if (!group.length) return null;
        return (
          <section key={kind} aria-label={kind === 'raw' ? 'Raw video' : 'Labeled images'}>
            <h3>{kind === 'raw' ? 'Raw video' : 'Labeled images'}</h3>
            <div className="wk-bucket-choices">
              {group.map(bucket => (
                <button
                  key={bucket.id}
                  type="button"
                  className="wk-bucket-choice"
                  aria-label={bucket.name}
                  aria-description={
                    unavailable.includes(bucket.id)
                      ? 'Already used by the opposite endpoint of this workflow'
                      : bucket.description || 'No images yet'
                  }
                  aria-pressed={value === bucket.id}
                  disabled={unavailable.includes(bucket.id)}
                  onClick={() => onChoose(bucket.id)}
                >
                  {kind === 'raw' ? <Database aria-hidden="true" /> : <Layers aria-hidden="true" />}
                  <span>
                    <strong>{bucket.name}</strong>
                    <small>
                      {unavailable.includes(bucket.id)
                        ? `Already used as this workflow’s ${direction === 'input' ? 'output' : 'input'}`
                        : bucket.description || 'No images yet'}
                    </small>
                  </span>
                  {value === bucket.id && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {!matches.length && (
        <p className="wk-hint">{query ? 'No buckets match your search.' : 'No labeled buckets yet.'}</p>
      )}
      {direction === 'output' && (
        <Button variant="outline" className="wk-new-bucket" onClick={onCreate}>
          <Plus />
          New labeled bucket
        </Button>
      )}
      {direction === 'input' && (
        <p className="wk-hint wk-settings-note">
          Choose a bucket’s current contents. Frozen dataset versions will also be available here once images have been
          processed and reviewed.
        </p>
      )}
    </div>
  );
}
