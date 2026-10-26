import { useId, useRef, useState } from 'react';
import { Clock3, Download, SlidersHorizontal } from 'lucide-react';
import { addDays, clockTime, normalizeClockInput, timeOnDay } from '../lib/archive/recordings.js';
import { recordedRange } from '../lib/archive-navigation';
import type { ReviewRange, Segment, Zone } from '../lib/types';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

type Props = {
  savedOnly: boolean;
  onSavedOnly: (saved: boolean) => void;
  onExport: () => void;
  canExport: boolean;
  hasSaved: boolean;
};
export function RecordingFilters(p: Props) {
  const savedId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={`filter-button${p.savedOnly ? ' is-active' : ''}`}
          aria-label="Filter recordings"
        >
          <SlidersHorizontal />
          <span>Filter</span>
          {p.savedOnly && <i />}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Filter recordings" align="end" className="recording-filter-popover">
        <h3>Filter recordings</h3>
        <div className="saved-filter">
          <label htmlFor={savedId}>Saved only</label>
          <Switch
            id={savedId}
            checked={p.savedOnly}
            disabled={!p.hasSaved && !p.savedOnly}
            onCheckedChange={p.onSavedOnly}
          />
        </div>
        <Button variant="ghost" className="export-recordings" disabled={!p.canExport} onClick={p.onExport}>
          <Download />
          Export filtered recordings
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** One discoverable range entry, shared by normal, mobile and fullscreen browsing. */
export function RecordingRange(p: {
  day: Date;
  zone: Zone;
  time: number;
  range: ReviewRange | null;
  segments: Segment[];
  onRange: (range: ReviewRange | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const endOfDay = addDays(p.day, 1, p.zone).getTime();
  const formatEnd = (time: number) => (time === endOfDay ? '24:00:00' : clockTime(new Date(time), p.zone, true));
  function show(value: boolean) {
    if (value) {
      const initial =
        p.range ??
        recordedRange(
          p.segments,
          Math.max(p.day.getTime(), p.time - 5 * 60000),
          Math.min(endOfDay, p.time + 5 * 60000),
        ) ??
        recordedRange(p.segments, p.day.getTime(), endOfDay);
      setFrom(initial ? clockTime(new Date(initial.from), p.zone, true) : '');
      setTo(initial ? formatEnd(initial.to) : '');
      setError('');
    }
    setOpen(value);
  }
  function apply(from: number, to: number) {
    const available = recordedRange(p.segments, from, to);
    if (!available) {
      setError('No footage in this time range. Choose a recorded time.');
      return;
    }
    p.onRange(available);
    setOpen(false);
  }
  function preset(minutes: number) {
    const start = Math.max(p.day.getTime(), p.time - minutes * 30000);
    apply(start, Math.min(endOfDay, start + minutes * 60000));
  }
  return (
    <Popover open={open} onOpenChange={show}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={`range-button${p.range ? ' is-active' : ''}`}
          aria-label={p.range ? 'Edit time range' : 'Choose time range'}
          disabled={!p.segments.length}
        >
          <Clock3 />
          <span>Time range</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Time range"
        align="end"
        className="recording-filter-popover recording-range-popover"
        onOpenAutoFocus={event => {
          event.preventDefault();
          title.current?.focus();
        }}
      >
        <h3 ref={title} tabIndex={-1}>
          Review a time range
        </h3>
        <p className="range-description">Choose any start and end time, across hours.</p>
        <form
          onSubmit={event => {
            event.preventDefault();
            const start = timeOnDay(p.day, from, p.zone);
            const value = normalizeClockInput(to);
            const end =
              value === '24:00' || value === '24:00:00' ? new Date(endOfDay) : timeOnDay(p.day, value, p.zone);
            if (!start || !end || end <= start) return setError('Enter an end time after the start time.');
            apply(start.getTime(), end.getTime());
          }}
        >
          <fieldset disabled={!p.segments.length}>
            <legend className="sr-only">Time range</legend>
            <div className="range-fields">
              <label>
                From
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="HH:mm:ss"
                  required
                  value={from}
                  onFocus={e => e.target.select()}
                  onBlur={() => setFrom(normalizeClockInput(from))}
                  onChange={e => setFrom(e.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="HH:mm:ss"
                  required
                  value={to}
                  onFocus={e => e.target.select()}
                  onBlur={() => setTo(normalizeClockInput(to))}
                  onChange={e => setTo(e.target.value)}
                />
              </label>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="range-error">
              {error}
            </p>
          )}
          <div className="range-presets" aria-label="Range around the current playback time">
            {[5, 15, 60].map(minutes => (
              <Button
                key={minutes}
                type="button"
                variant="secondary"
                disabled={
                  !recordedRange(
                    p.segments,
                    Math.max(p.day.getTime(), p.time - minutes * 30000),
                    Math.min(endOfDay, p.time + minutes * 30000),
                  )
                }
                onClick={() => preset(minutes)}
              >
                {minutes === 60 ? '1 hour' : `${minutes} min`}
              </Button>
            ))}
          </div>
          <Button type="submit" className="apply-range" disabled={!p.segments.length}>
            Review range
          </Button>
        </form>
        {p.range && (
          <Button
            variant="ghost"
            className="clear-range"
            onClick={() => {
              p.onRange(null);
              setOpen(false);
            }}
          >
            Clear time range
          </Button>
        )}
        <p className="range-availability-note">24-hour time · Empty edges trim to recorded footage.</p>
      </PopoverContent>
    </Popover>
  );
}
