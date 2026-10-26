import { PlayCircle } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { LoadingStatus } from '../../../components/brand-indicator';
import { SightingList } from './sighting-panel';
import { useRunReview } from '../hooks/use-run-review';
import { nextPending, sightingState } from '../utils/sightingInferenceUtil';

/** A finished or running full run's sightings, with the way into reviewing them beside the video. */
export function RunSightings({
  runId,
  version,
  onReview,
}: {
  runId: string;
  version: unknown;
  onReview: (item?: string) => void;
}) {
  const { sightings, review, error } = useRunReview(runId, version);
  const pending = sightings.filter(sighting => sightingState(sighting) === 'pending').length;
  const next = sightings[nextPending(sightings, -1)];
  return (
    <section className="wk-run-results wk-run-sightings" aria-labelledby="run-sightings">
      <header>
        <h2 id="run-sightings">Sightings</h2>
        <span>
          {sightings.length} {sightings.length === 1 ? 'sighting' : 'sightings'}
          {sightings.length ? ` · ${pending ? `${pending} to review` : 'all reviewed'}` : ''}
        </span>
        {sightings.length > 0 && (
          <Button
            className={pending ? 'wk-primary' : undefined}
            variant={pending ? 'default' : 'outline'}
            onClick={() => onReview(next?.frames[0].id)}
          >
            <PlayCircle />
            {pending ? 'Review sightings' : 'Open sightings'}
          </Button>
        )}
      </header>
      {error && (
        <p role="alert" className="wk-error">
          {error}
        </p>
      )}
      {!review ? (
        !error && <LoadingStatus>Loading sightings…</LoadingStatus>
      ) : sightings.length ? (
        <SightingList sightings={sightings} current="" onSelect={id => onReview(id)} />
      ) : (
        <p className="wk-run-empty">No sightings were saved from this run.</p>
      )}
    </section>
  );
}
