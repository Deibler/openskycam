import { LoadingStatus } from './brand-indicator';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowRight, Bookmark, ChevronDown, CornerDownLeft, X } from 'lucide-react';
import {
  addDays,
  clockTime,
  parseDay,
  normalizeClockInput,
  recordingsCsv,
  timeOnDay,
} from '../lib/archive/recordings.js';
import { formatDuration } from '../lib/archive/format.js';
import { hourStart, recordingHours, timeWithFootage, type RecordingHour } from '../lib/archive-navigation';
import type { ReviewRange, Segment, Zone } from '../lib/types';
import { Button } from './ui/button';
import { RecordingFilters, RecordingRange } from './recording-filters';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

type Props = {
  browseOnly?: boolean;
  dayKey: string;
  zone: Zone;
  cam: string;
  segments: Segment[];
  selected: Segment | null;
  playhead: number;
  loading: boolean;
  saved: Set<string>;
  range: ReviewRange | null;
  searchRef: RefObject<HTMLInputElement | null>;
  onSelect: (segment: Segment) => void;
  onSeek: (time: Date) => void;
  onRange: (range: ReviewRange | null) => void;
  notify: (message: string) => void;
};
export function RecordingBrowser(p: Props) {
  const [savedOnly, setSavedOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [timeError, setTimeError] = useState('');
  const [browseHour, setBrowseHour] = useState<number | null>();
  const content = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const day = parseDay(p.dayKey, p.zone)!;
  const inRange = useMemo(
    () =>
      p.range
        ? p.segments.filter(
            s => Date.parse(s.start) < p.range!.to && Date.parse(s.start) + (s.duration_s ?? 60) * 1000 > p.range!.from,
          )
        : p.segments,
    [p.segments, p.range],
  );
  const filtered = useMemo(
    () => (savedOnly ? inRange.filter(s => p.saved.has(`${p.cam}/${s.start}`)) : inRange),
    [inRange, savedOnly, p.saved, p.cam],
  );
  const hours = useMemo(() => recordingHours(filtered, p.zone, p.range?.from), [filtered, p.zone, p.range?.from]);
  const currentHour = p.selected ? hourStart(Date.parse(p.selected.start), p.zone) : null;
  const wantedHour = browseHour === undefined ? currentHour : browseHour;
  const activeHour =
    browseHour === null ? null : (hours.find(h => h.start === wantedHour)?.start ?? hours.at(-1)?.start);
  const currentListed = p.selected && filtered.some(s => s.start === p.selected!.start);
  const awayFromPlayback = p.selected && ((!p.range && activeHour !== currentHour) || !currentListed);
  useEffect(() => {
    setBrowseHour(undefined);
    setQuery('');
    setTimeError('');
  }, [p.dayKey, p.zone, p.cam]);
  useEffect(() => {
    if (!p.browseOnly) setBrowseHour(undefined);
  }, [p.selected?.start, p.browseOnly]);
  useLayoutEffect(() => {
    const parent = content.current;
    if (!parent) return;
    parent.style.paddingBottom = '12px';
    if (p.range) {
      parent.scrollTop = 0;
      return;
    }
    const expanded = parent.querySelector<HTMLElement>('.recording-hour.is-open');
    const last = parent.lastElementChild;
    if (!expanded || !last) return;
    // Space belongs after the list, so short hours don't push the following hours away.
    const reserveEnd = () => {
      parent.style.paddingBottom = `${Math.max(12, parent.clientHeight - (last.getBoundingClientRect().bottom - expanded.getBoundingClientRect().top))}px`;
    };
    reserveEnd();
    parent.scrollTop += expanded.getBoundingClientRect().top - parent.getBoundingClientRect().top;
    const observer = new ResizeObserver(reserveEnd);
    observer.observe(parent);
    observer.observe(expanded);
    return () => observer.disconnect();
  }, [activeHour, p.range, p.dayKey, savedOnly]);
  useEffect(() => {
    const parent = content.current;
    const row = parent?.querySelector<HTMLElement>('.minute-picker [aria-current="true"]');
    if (!row || !parent) return;
    const reveal = () => {
      const box = row.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      const heading = row.closest('.recording-hour')?.querySelector('h3')?.getBoundingClientRect().height ?? 50;
      if (box.top < bounds.top + heading + 8 || box.bottom > bounds.bottom - 6)
        parent.scrollTop += box.top - bounds.top - Math.max(heading + 8, bounds.height / 3);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [p.selected?.start, activeHour, savedOnly, p.range]);
  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([recordingsCsv(filtered, p.cam, p.zone)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${p.cam}-${p.dayKey}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    p.notify('Exported the filtered recordings.');
  }
  function returnToPlayback() {
    setSavedOnly(false);
    setBrowseHour(undefined);
    if (p.selected && !inRange.some(s => s.start === p.selected?.start)) p.onRange(null);
  }
  return (
    <aside className="recording-browser" aria-label="Browse recordings">
      <div className="browser-heading">
        <div>
          <h2>Find footage</h2>
          <p>
            {p.loading
              ? 'Loading archive…'
              : p.range || savedOnly
                ? `${filtered.length} of ${p.segments.length} recordings`
                : `${p.segments.length} recordings · ${formatDuration(p.segments.reduce((sum, s) => sum + (s.duration_s ?? 0), 0))}`}
          </p>
        </div>
        <RecordingFilters
          savedOnly={savedOnly}
          hasSaved={inRange.some(s => p.saved.has(`${p.cam}/${s.start}`))}
          onSavedOnly={setSavedOnly}
          onExport={exportCsv}
          canExport={filtered.length > 0}
        />
      </div>
      <div className="finder-label-row">
        <label htmlFor={inputId}>Go to time</label>
        <RecordingRange
          day={day}
          zone={p.zone}
          time={p.playhead || day.getTime()}
          range={p.range}
          segments={savedOnly ? p.segments.filter(s => p.saved.has(`${p.cam}/${s.start}`)) : p.segments}
          onRange={p.onRange}
        />
      </div>
      <form
        className="time-finder"
        onSubmit={e => {
          e.preventDefault();
          const time = timeOnDay(day, query, p.zone);
          if (!time) {
            setTimeError('Use a 24-hour time, like 19:42 or 19:42:30.');
            return;
          }
          const recorded = timeWithFootage(p.segments, day, query, p.zone);
          if (!recorded) {
            setTimeError('No footage at this time. Choose a recorded minute below.');
            return;
          }
          setTimeError('');
          setQuery('');
          setSavedOnly(false);
          setBrowseHour(undefined);
          p.onSeek(recorded);
        }}
      >
        <div className="browser-search">
          <input
            id={inputId}
            ref={p.searchRef}
            type="text"
            inputMode="numeric"
            placeholder="19:42:30"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setTimeError('');
            }}
            onBlur={() => setQuery(normalizeClockInput(query))}
            aria-invalid={Boolean(timeError)}
            aria-describedby={timeError ? `${inputId}-error` : undefined}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label="Play at this time"
            disabled={!query.trim() || p.loading}
          >
            <ArrowRight />
          </Button>
        </div>
        {timeError && (
          <p id={`${inputId}-error`} className="time-finder-error" role="alert">
            {timeError}
          </p>
        )}
      </form>
      {(p.range || savedOnly) && (
        <div className="active-recording-filters" aria-label="Active recording filters">
          {savedOnly && (
            <button onClick={() => setSavedOnly(false)} aria-label="Clear saved-only filter">
              <Bookmark />
              Saved
              <X />
            </button>
          )}
          {p.range && (
            <button onClick={() => p.onRange(null)} aria-label="Clear time range">
              {clockTime(new Date(p.range.from), p.zone, p.range.from % 60000 !== 0)} –{' '}
              {p.range.to === addDays(day, 1, p.zone).getTime()
                ? '24:00'
                : clockTime(new Date(p.range.to), p.zone, p.range.to % 60000 !== 0)}
              <X />
            </button>
          )}
        </div>
      )}
      <div ref={content} className={`browser-content${p.range ? ' is-range' : ''}`} aria-busy={p.loading}>
        {hours.map(group => (
          <HourRecordings
            key={group.start}
            group={group}
            zone={p.zone}
            range={p.range}
            selected={p.selected}
            expanded={Boolean(p.range) || activeHour === group.start}
            repeated={hours.filter(other => other.label === group.label).length > 1}
            onToggle={() => setBrowseHour(activeHour === group.start ? null : group.start)}
            onSelect={p.onSelect}
          />
        ))}
        {!hours.length && (
          <div className="empty-list">
            {p.loading && <LoadingStatus>Loading recordings</LoadingStatus>}
            <h3 hidden={p.loading}>
              {p.loading
                ? 'Loading recordings'
                : savedOnly
                  ? 'No saved recordings here'
                  : p.range
                    ? 'No footage in this range'
                    : 'No recordings on this day'}
            </h3>
            <p hidden={p.loading}>
              {savedOnly
                ? 'Save a recording using the bookmark on the player.'
                : p.range
                  ? 'Try a wider time range.'
                  : 'Choose another date, or open Latest.'}
            </p>
          </div>
        )}
      </div>
      {awayFromPlayback && (
        <Button variant="ghost" className="return-to-playback" onClick={returnToPlayback}>
          <CornerDownLeft />
          Show playing recording
        </Button>
      )}
    </aside>
  );
}

function HourRecordings({
  group,
  zone,
  range,
  selected,
  expanded,
  repeated,
  onToggle,
  onSelect,
}: {
  group: RecordingHour;
  zone: Zone;
  range: ReviewRange | null;
  selected: Segment | null;
  expanded: boolean;
  repeated: boolean;
  onToggle: () => void;
  onSelect: (segment: Segment) => void;
}) {
  const id = useId();
  const [focusedMinute, setFocusedMinute] = useState<number | null>(null);
  const selectedMinute =
    selected && group.segments.some(s => s.start === selected.start)
      ? Math.floor((Math.max(Date.parse(selected.start), range?.from ?? -Infinity) - group.start) / 60000)
      : -1;
  const recordedMinutes = [...group.minutes.keys()];
  const firstRow = Math.floor(Math.min(...recordedMinutes) / 6) * 6;
  const lastRow = Math.ceil((Math.max(...recordedMinutes) + 1) / 6) * 6;
  const minutes = Array.from({ length: lastRow - firstRow }, (_, index) => firstRow + index).filter(
    minute => !range || (group.start + minute * 60000 < range.to && group.start + (minute + 1) * 60000 > range.from),
  );
  const available = minutes.filter(minute => group.minutes.has(minute));
  const from = Math.max(group.start, range?.from ?? group.start);
  const to = Math.min(group.start + 3600000, range?.to ?? Infinity);
  const timeLabel = `${clockTime(new Date(from), zone, from % 60000 !== 0)} – ${clockTime(new Date(to), zone, to % 60000 !== 0)}${repeated ? ` ${group.offset}` : ''}`;
  useEffect(() => setFocusedMinute(null), [selected?.start, expanded]);
  const heading = (
    <>
      <span>{timeLabel}</span>
      <small>{group.segments.length} recordings</small>
      {selectedMinute >= 0 && <i aria-label="Contains playing recording" />}
    </>
  );
  return (
    <section className={`recording-hour${expanded ? ' is-open' : ''}${selectedMinute >= 0 ? ' contains-current' : ''}`}>
      <h3>
        {range ? (
          <div className="recording-hour-label">{heading}</div>
        ) : (
          <button
            className="recording-hour-toggle"
            aria-expanded={expanded}
            aria-controls={id}
            aria-label={`Browse ${timeLabel}`}
            onClick={onToggle}
          >
            <ChevronDown />
            {heading}
          </button>
        )}
      </h3>
      {expanded && (
        <div id={id} className="recording-hour-content">
          <div className="minute-heading">
            <span>Minute</span>
            <span>{zone === 'UTC' ? 'UTC' : 'Local time'}</span>
          </div>
          <div
            className="minute-picker"
            aria-label={`Minutes in ${group.label}`}
            onKeyDown={event => {
              const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-minute]');
              if (!target || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                return;
              event.preventDefault();
              const minute = Number(target.dataset.minute);
              let next =
                event.key === 'Home'
                  ? available[0]
                  : event.key === 'End'
                    ? available.at(-1)!
                    : minute + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[event.key] ?? 0);
              const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
              while (next >= 0 && next < 60 && !available.includes(next)) next += direction;
              const button = event.currentTarget.querySelector<HTMLButtonElement>(`button[data-minute="${next}"]`);
              if (button && !button.disabled) {
                setFocusedMinute(next);
                button.focus();
              }
            }}
          >
            {minutes.map(minute => {
              const clips = group.minutes.get(minute) ?? [];
              const current = selectedMinute === minute && clips.some(s => s.start === selected?.start);
              const label = `${clockTime(new Date(group.start + minute * 60000), zone)}${clips.length ? `, ${clips.length} recording${clips.length > 1 ? 's' : ''}` : ', no footage'}${current ? ', currently in player' : ''}`;
              const focus =
                focusedMinute !== null && available.includes(focusedMinute)
                  ? focusedMinute
                  : available.includes(selectedMinute)
                    ? selectedMinute
                    : available[0];
              const props = {
                className: `minute-button${current ? ' is-selected' : ''}`,
                'data-minute': minute,
                'aria-label': label,
                'aria-current': current ? ('true' as const) : undefined,
                tabIndex: minute === focus ? 0 : -1,
              };
              const content = (
                <>
                  {String(minute).padStart(2, '0')}
                  {clips.length > 1 && <i />}
                </>
              );
              return clips.length > 1 ? (
                <DropdownMenu key={minute}>
                  <DropdownMenuTrigger asChild>
                    <button {...props}>{content}</button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="menu-content">
                    {clips.map(s => (
                      <DropdownMenuItem key={s.start} onSelect={() => onSelect(s)}>
                        {clockTime(new Date(s.start), zone, true)}
                        <span>{formatDuration(s.duration_s ?? 0)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button key={minute} {...props} disabled={!clips.length} onClick={() => onSelect(clips[0])}>
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
