import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { LoadingStatus } from '../../../components/brand-indicator';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { NextReview } from '../models/reviewInferencemodel';
import type { WorkflowDraft } from '../models/workflowInferencemodel';
import type { Sighting } from '../models/sightingInferencemodel';
import { useReviewDecisions } from '../hooks/use-review-decisions';
import { useNextReview } from '../hooks/use-next-review';
import { useRunReview } from '../hooks/use-run-review';
import { sightingClip, sightingState } from '../utils/sightingInferenceUtil';
import { SightingFeed } from './sighting-feed';

type Filter = 'pending' | 'all';

/** A run's sightings as a feed, opening on those still to review and ending on what to review next. */
export function RunReview({
  runId,
  itemId,
  buckets,
  workflows,
  onItem,
  onNext,
  onBack,
  onEditState,
}: {
  runId: string;
  itemId: string;
  buckets: WorkshopBucket[];
  workflows: WorkflowDraft[];
  onItem: (id: string) => void;
  onNext: (next: NextReview) => void;
  onBack: () => void;
  onEditState?: (dirty: boolean, busy: boolean) => void;
}) {
  const { review, sightings, error, reload } = useRunReview(runId);
  const next = useNextReview(review?.run.workflow_id, runId, workflows);
  const decisions = useReviewDecisions();
  // The feed keeps the sightings it opened with, so a decided card stays put instead of vanishing mid-swipe.
  const [filter, setFilter] = useState<Filter | null>(null),
    [order, setOrder] = useState<Sighting[]>([]),
    [start, setStart] = useState({ at: 0, session: 0 });
  const focused = useRef(itemId);
  const live = (s: Sighting): Sighting => ({ ...s, frames: s.frames.map(decisions.latest) });
  const clips = useMemo(
    () => new Map(order.map(s => [s.id, sightingClip(s, review?.recordings ?? [])])),
    [order, review],
  );
  const left = sightings.filter(s => sightingState(live(s)) === 'pending').length;

  function show(next: Filter, focus = focused.current) {
    const list = next === 'all' ? sightings : sightings.filter(s => sightingState(live(s)) === 'pending');
    setFilter(next);
    setOrder(list);
    setStart(prev => ({
      at: Math.max(
        0,
        list.findIndex(s => s.frames.some(f => f.id === focus)),
      ),
      session: prev.session + 1,
    }));
  }
  useEffect(() => {
    if (!review || filter) return;
    const focus = sightings.find(s => s.frames.some(f => f.id === itemId));
    show(focus && sightingState(focus) !== 'pending' ? 'all' : 'pending', itemId);
  }, [review]);

  const decided = sightings.length - left;
  return (
    <div className="wk-reviewer dark">
      <header className="wk-reviewer-bar">
        <button type="button" className="wk-glass wk-round" aria-label="Back" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="wk-reviewer-title">
          <h1>{review?.run.name ?? 'Opening run…'}</h1>
          {review && (
            <p>
              {left ? `${left} of ${sightings.length} to review` : `All ${sightings.length} reviewed`} ·{' '}
              {new Date(review.run.created_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
              {review.has_more ? ' · first 1,000 photos' : ''}
            </p>
          )}
        </div>
        {review && (
          <div className="wk-feed-tabs" role="group" aria-label="Show">
            {(['pending', 'all'] as const).map(f => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => show(f)}>
                {f === 'pending' ? 'To review' : 'All'}
              </button>
            ))}
          </div>
        )}
        <div
          className="wk-reviewer-progress"
          role="progressbar"
          aria-label="Sightings reviewed"
          aria-valuemin={0}
          aria-valuemax={sightings.length}
          aria-valuenow={decided}
        >
          <i style={{ width: `${sightings.length ? (decided / sightings.length) * 100 : 0}%` }} />
        </div>
      </header>
      {/* The feed waits for its order: a feed that first held only the end card stays snapped to it as cards arrive. */}
      {!review || !filter ? (
        <div className="wk-reviewer-empty">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <Button onClick={reload}>Try again</Button>
            </>
          ) : (
            <LoadingStatus>Opening run…</LoadingStatus>
          )}
        </div>
      ) : (
        <SightingFeed
          key={start.session}
          sightings={order.map(live)}
          clips={clips}
          decisions={decisions}
          start={start.at}
          onEditState={onEditState}
          bucket={s => buckets.find(b => b.id === s.bucketId)?.name ?? 'Bucket'}
          onFocus={id => {
            focused.current = id;
            onItem(id);
          }}
          end={
            <EndCard
              total={sightings.length}
              left={left}
              filter={filter}
              next={next}
              onShow={f => show(f, '')}
              onNext={onNext}
              onBack={onBack}
            />
          }
        />
      )}
    </div>
  );
}

function EndCard({
  total,
  left,
  filter,
  next,
  onShow,
  onNext,
  onBack,
}: {
  total: number;
  left: number;
  filter: Filter | null;
  next: NextReview | null;
  onShow: (filter: Filter) => void;
  onNext: (next: NextReview) => void;
  onBack: () => void;
}) {
  return (
    <article className="wk-card wk-end" aria-label="End of sightings">
      <span className="wk-end-mark" data-done={!left || undefined}>
        <Check />
      </span>
      <h2>{!total ? 'Nothing to review' : left ? `${left} still to review` : 'All caught up'}</h2>
      <p>
        {!total
          ? 'This run found no sightings.'
          : left
            ? 'Some sightings were passed without a Yes or No.'
            : 'Every sighting in this run has a Yes or No.'}
      </p>
      <div>
        {left > 0 && <Button onClick={() => onShow('pending')}>Review the rest</Button>}
        {next && (
          <Button variant={left ? 'outline' : 'default'} onClick={() => onNext(next)}>
            {next.name} · {next.pending.toLocaleString()} to review
          </Button>
        )}
        {filter === 'pending' && total > 0 && (
          <Button variant="outline" onClick={() => onShow('all')}>
            Show all sightings
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          Done
        </Button>
      </div>
    </article>
  );
}
