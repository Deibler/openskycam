import { useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronLeft, Download } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { LoadingStatus } from '../../../components/brand-indicator';
import { recordingOf } from '../../../../src/utils/recordingInferenceUtil';
import type { Sighting } from '../models/sightingInferencemodel';
import type { useReviewDecisions } from '../hooks/use-review-decisions';
import { sightingClip } from '../utils/sightingInferenceUtil';
import { SightingFeed } from './sighting-feed';

const retained = (s: Sighting) => s.frames.every(f => f.object_key.startsWith('retained/'));

/** A bucket's sightings full screen, from the one tapped in its grid, loading more as it nears the end. */
export function BucketFeed({
  title,
  total,
  sightings,
  start,
  decisions,
  runName,
  hasMore,
  onMore,
  onRetain,
  onFocus,
  onBack,
  onEditState,
}: {
  title: string;
  total: number;
  sightings: Sighting[];
  start: number;
  decisions: ReturnType<typeof useReviewDecisions>;
  runName: (id: string) => string;
  hasMore: boolean;
  onMore: () => void;
  onRetain: (ids: string[]) => void;
  onFocus: (itemId: string) => void;
  onBack: () => void;
  onEditState?: (dirty: boolean, busy: boolean) => void;
}) {
  const [at, setAt] = useState(start);
  useEffect(() => {
    if (hasMore && at >= sightings.length - 3) onMore();
  }, [at, sightings]);
  // Each photo names the recording it came from, so a sighting's clip is known the moment it is tapped.
  const clips = useMemo(
    () =>
      new Map(
        sightings.map(s => {
          const recording = recordingOf(JSON.parse(s.frames[0].provenance_json));
          return [s.id, recording ? sightingClip(s, [recording]) : null];
        }),
      ),
    [sightings],
  );

  return (
    <div className="wk-reviewer dark">
      <header className="wk-reviewer-bar">
        <button type="button" className="wk-glass wk-round" aria-label="Back to bucket" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="wk-reviewer-title">
          <h1>{title}</h1>
          <p>
            {total.toLocaleString()} {total === 1 ? 'photo' : 'photos'}
          </p>
        </div>
      </header>
      <SightingFeed
        sightings={sightings}
        clips={clips}
        decisions={decisions}
        start={start}
        onEditState={onEditState}
        bucket={s => runName(s.frames[0].run_id)}
        onFocus={(id, index) => {
          setAt(index);
          onFocus(id);
        }}
        actions={(s, frame) => (
          <>
            <button
              type="button"
              className="wk-action"
              data-kind="save"
              aria-pressed={retained(s)}
              title="Keep beyond expiration"
              aria-label={retained(s) ? 'Saved' : 'Save images beyond expiration'}
              onClick={() => {
                if (!retained(s)) onRetain(s.frames.filter(f => !f.object_key.startsWith('retained/')).map(f => f.id));
              }}
            >
              <span>
                <Bookmark />
              </span>
              <small>{retained(s) ? 'Saved' : 'Save'}</small>
            </button>
            <a
              className="wk-action"
              href={frame.image_url}
              download={`${frame.cam}-${frame.captured_at}.jpg`}
              title="Download original"
              aria-label="Download original image"
            >
              <span>
                <Download />
              </span>
              <small>Get</small>
            </a>
          </>
        )}
        end={
          <article className="wk-card wk-end" aria-label="End of sightings">
            {hasMore ? (
              <LoadingStatus>Loading more…</LoadingStatus>
            ) : (
              <>
                <h2>That’s everything</h2>
                <p>
                  {sightings.length} {sightings.length === 1 ? 'sighting' : 'sightings'} match these filters.
                </p>
                <div>
                  <Button onClick={onBack}>Done</Button>
                </div>
              </>
            )}
          </article>
        }
      />
    </div>
  );
}
