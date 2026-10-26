import { useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clockTime } from '../lib/archive/recordings.js';
import { coverageRanges, playbackWindow, snapToFootage, type TimelineScale } from '../lib/archive-navigation';
import type { ReviewRange, Segment, Zone } from '../lib/types';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/** A moment on the timeline, such as a sighting to review. `current` is the one being reviewed. */
export type TimelineMark = { at: number; state: 'pending' | 'accepted' | 'rejected' | 'current' };
type Props = {
  marks?: TimelineMark[];
  onInteractionChange?: (open: boolean) => void;
  day: Date;
  zone: Zone;
  segments: Segment[];
  selected: Segment | null;
  time: number;
  range: ReviewRange | null;
  onClearRange: () => void;
  onSeek: (time: Date) => void;
  loop?: ReviewRange | null;
  onExitLoop?: () => void;
};
export function RecordingScrubber({
  marks,
  day,
  zone,
  segments,
  selected,
  time,
  range,
  loop,
  onExitLoop,
  onClearRange,
  onSeek,
  onInteractionChange,
}: Props) {
  const [scale, setScale] = useState<TimelineScale>(() => {
    try {
      const saved = localStorage.getItem('skyvision-timeline-scale');
      return saved === 'clip' || saved === 'day' ? saved : 'hour';
    } catch {
      return 'hour';
    }
  });
  const [draft, setDraft] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const direction = useRef(0);
  // Radix commits keyboard changes before onValueChange; only pointer gestures need a draft.
  const dragging = useRef(false);
  const { from, to } = loop ?? range ?? playbackWindow(day, zone, scale, selected);
  const span = to - from;
  const ranges = useMemo(() => coverageRanges(segments, from, to), [segments, from, to]);
  const position = (instant: number) => Math.max(0, Math.min(100, ((instant - from) / span) * 100));
  const value = Math.max(from, Math.min(to - 1, draft ?? time));
  const preview = draft ?? hover;
  const available = preview !== null && ranges.some(range => preview >= range.start && preview < range.end);
  const precise = Boolean(loop) || scale === 'clip';
  const previewTime = (instant: number) =>
    `${clockTime(new Date(instant), zone, true)}${precise ? `.${Math.floor(new Date(instant).getMilliseconds() / 100)}` : ''}`;
  const selectedStart = selected ? Date.parse(selected.start) : 0;
  const selectedEnd = selectedStart + (selected?.duration_s ?? 60) * 1000;
  function changeScale(value: TimelineScale) {
    onExitLoop?.();
    onClearRange();
    setDraft(null);
    setHover(null);
    setScale(value);
    try {
      localStorage.setItem('skyvision-timeline-scale', value);
    } catch {
      /* Available for this session. */
    }
  }
  return (
    <div className="recording-scrubber">
      <div className="scrubber-heading">
        <span>{loop ? 'Replaying section' : range ? 'Selected range' : 'Timeline'}</span>
        <DropdownMenu onOpenChange={onInteractionChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="timeline-scale-control"
              aria-label={`Timeline scale, ${loop ? 'replay loop' : range ? 'selected range' : scale === 'clip' ? 'one recording' : scale === 'hour' ? 'one hour' : 'whole day'}`}
            >
              <span className="timeline-scale-label">Scale: </span>
              {loop ? 'Loop' : range ? 'Range' : scale === 'clip' ? 'Recording' : scale === 'hour' ? '1 hour' : 'Day'}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="menu-content">
            <DropdownMenuRadioGroup
              value={loop || range ? '' : scale}
              onValueChange={value => changeScale(value as TimelineScale)}
            >
              <DropdownMenuRadioItem value="clip">One recording</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hour">One hour</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="day">Whole day</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="scrubber-track-wrap"
        onPointerMove={event => {
          if (event.pointerType !== 'touch') {
            const rect = event.currentTarget.getBoundingClientRect();
            setHover(from + Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width)) * span);
          }
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="scrubber-coverage" aria-hidden="true">
          {ranges.map(range => (
            <span
              key={range.start}
              style={{ left: `${position(range.start)}%`, width: `${position(range.end) - position(range.start)}%` }}
            />
          ))}
          {selected && (
            <i
              style={{
                left: `${position(selectedStart)}%`,
                width: `${position(selectedEnd) - position(selectedStart)}%`,
              }}
            />
          )}
          {marks
            ?.filter(mark => mark.at >= from && mark.at < to)
            .map((mark, index) => (
              <b key={index} data-state={mark.state} style={{ left: `${position(mark.at)}%` }} />
            ))}
        </div>
        <Slider
          className="archive-slider"
          aria-label={`Seek recordings, ${loop ? 'replay loop' : range ? 'selected range' : scale} view`}
          aria-valuetext={`${previewTime(value)}${zone === 'UTC' ? ' UTC' : ''}`}
          min={0}
          max={span / 1000 - 0.001}
          step={loop ? 0.1 : scale === 'day' ? 30 : scale === 'hour' ? 1 : 0.1}
          value={[(value - from) / 1000]}
          disabled={!ranges.length}
          onValueChange={([value]) => {
            if (dragging.current) setDraft(snapToFootage(ranges, from + value * 1000));
          }}
          onValueCommit={([value]) => {
            const recorded = snapToFootage(ranges, from + value * 1000, direction.current);
            direction.current = 0;
            setDraft(null);
            setHover(null);
            onInteractionChange?.(false);
            if (recorded !== null) onSeek(new Date(recorded));
          }}
          onKeyDownCapture={event => {
            dragging.current = false;
            direction.current = ['ArrowLeft', 'ArrowDown', 'PageDown', 'Home'].includes(event.key) ? -1 : 1;
          }}
          onPointerDown={() => {
            dragging.current = true;
            direction.current = 0;
            onInteractionChange?.(true);
          }}
          onPointerUp={() => {
            dragging.current = false;
            setDraft(null);
            onInteractionChange?.(false);
          }}
          onLostPointerCapture={() => {
            dragging.current = false;
            setDraft(null);
            onInteractionChange?.(false);
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setDraft(null);
            setHover(null);
            onInteractionChange?.(false);
          }}
        />
        {preview !== null && (
          <div className="scrubber-preview" style={{ left: `${Math.max(11, Math.min(89, position(preview)))}%` }}>
            <strong>{previewTime(preview)}</strong>
            <span>{available ? 'Recorded' : 'No footage'}</span>
          </div>
        )}
      </div>
      <div className="scrubber-ruler" aria-hidden="true">
        {[0, 1, 2, 3, 4].map(tick => (
          <span key={tick}>
            {clockTime(
              new Date(from + (span * tick) / 4),
              zone,
              Boolean(loop) || scale === 'clip' || Boolean(range && (from % 60000 !== 0 || to % 60000 !== 0)),
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
