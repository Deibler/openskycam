import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { Thumbnail } from './thumbnail';
import { sightingState, topLabel } from '../utils/sightingInferenceUtil';
import type { Sighting, SightingState } from '../models/sightingInferencemodel';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const stateLabel: Record<SightingState, string> = {
  pending: 'Unreviewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  mixed: 'Partly accepted',
};
export function StateIcon({ state }: { state: SightingState }) {
  return state === 'accepted' || state === 'mixed' ? (
    <CheckCircle2 aria-hidden="true" data-state={state} />
  ) : state === 'rejected' ? (
    <XCircle aria-hidden="true" data-state={state} />
  ) : (
    <Circle aria-hidden="true" data-state={state} />
  );
}

export function SightingList({
  sightings,
  current,
  onSelect,
}: {
  sightings: Sighting[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ol className="wk-sighting-list">
      {sightings.map(sighting => {
        const state = sightingState(sighting),
          first = sighting.frames[0];
        return (
          <li key={sighting.id}>
            <button
              type="button"
              aria-current={sighting.id === current || undefined}
              onClick={() => onSelect(sighting.id)}
            >
              <span className="wk-sighting-thumb">
                <Thumbnail item={first} crop />
              </span>
              <span>
                <strong>{topLabel(first)?.class_name ?? sighting.className}</strong>
                <small>
                  {time(first.captured_at)} · {sighting.frames.length}{' '}
                  {sighting.frames.length === 1 ? 'frame' : 'frames'}
                </small>
              </span>
              <span className="wk-sighting-state" data-state={state}>
                <StateIcon state={state} />
                <span className="sr-only">{stateLabel[state]}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
