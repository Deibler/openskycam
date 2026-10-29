import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { LoadingStatus } from '../../../components/brand-indicator';
import { useAvailableDays } from '../../../hooks/use-available-days';
import { fetchSegments, videoUrl } from '../../../lib/archive/api.js';
import { formatBytes, formatDuration } from '../../../lib/archive/format.js';
import { summarizeFootage } from '../utils/footageInferenceUtil';
import { fullTime, isRelativeDay, latestUntil, relativeDays, resolveDay } from '../utils/scheduleInferenceUtil';
import { SettingsChoices, SettingsRow } from './node-settings-controls';
import type { FootageStep, NodeSettingsScreen, ScheduleStep } from '../models/workflowInferencemodel';
import type { Segment } from '../../../lib/types';

const dayLabel = (day: string) =>
  isRelativeDay(day)
    ? relativeDays[day].label
    : new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });

export function FootageFields({
  data,
  camera,
  schedule,
  onChange,
  screen,
  onNavigate,
}: {
  data: FootageStep;
  camera: string;
  schedule?: ScheduleStep;
  onChange: (data: FootageStep) => void;
  screen: NodeSettingsScreen;
  onNavigate: (screen: NodeSettingsScreen) => void;
}) {
  const availability = useAvailableDays(camera, 'UTC', undefined);
  const days = [...(availability.days ?? [])].sort().reverse();
  const [loaded, setLoaded] = useState<{ day: string; rows: Segment[] }>({ day: '', rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(data.from),
    [until, setUntil] = useState(data.until);
  // A relative day previews the day it resolves to now; its range is not limited to that day's recordings.
  const relative = isRelativeDay(data.day),
    day = resolveDay(data.day);
  const rows = loaded.day === day ? loaded.rows : [];
  // A schedule reruns this workflow, so its day must move with each run and a same-day window must upload first.
  const limit = latestUntil(schedule),
    endBy = data.day === 'run-day' ? limit : null;
  // New footage takes recordings as they upload, which is always the day of the run.
  const dayOptions = Object.entries(relativeDays).filter(
    ([value]) =>
      !(value === 'run-day' && limit === '') && !(value === 'previous-day' && schedule?.trigger === 'arrival'),
  );
  useEffect(() => {
    setFrom(data.from);
    setUntil(data.until);
  }, [data.from, data.until]);
  useEffect(() => {
    setError('');
    if (!camera || !day) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    const start = new Date(`${day}T00:00:00Z`);
    void fetchSegments(camera, start, new Date(start.getTime() + 86400000), abort.signal)
      .then(rows => {
        if (!abort.signal.aborted) setLoaded({ day, rows });
      })
      .catch(error => {
        if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load recordings.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [camera, day]);
  const toMillis = (time: string) => Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
  const summary = summarizeFootage(rows, toMillis(data.from), toMillis(data.until), data.interval);
  const first = rows[0],
    last = rows.at(-1);
  const minimum = first?.start.slice(11, 19) ?? '';
  const maximum = last
    ? new Date(Math.min(Date.parse(`${day}T23:59:59Z`), Date.parse(last.start) + (last.duration_s ?? 60) * 1000))
        .toISOString()
        .slice(11, 19)
    : '';
  function apply(nextFrom = from, nextUntil = until) {
    const a = toMillis(nextFrom),
      b = toMillis(nextUntil),
      selected = summarizeFootage(rows, a, b, data.interval);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) {
      setError('Choose a start time before the end time.');
      return;
    }
    if (endBy && fullTime(nextUntil) > endBy) {
      setError(`End by ${endBy} UTC so the window uploads before the ${schedule!.at} UTC schedule.`);
      return;
    }
    if (!relative && !selected.clips.length) {
      setError('Choose a time range containing recorded footage.');
      return;
    }
    if (!relative && (a < toMillis(minimum) || b > toMillis(maximum))) {
      setError(`The recorded window is ${minimum}–${maximum} UTC.`);
      return;
    }
    onChange({ ...data, from: nextFrom, until: nextUntil });
    setError('');
    onNavigate('overview');
  }
  const errors = (error || availability.error) && (
    <p className="wk-error wk-hint" role="alert">
      {error || availability.error}
      {availability.error && (
        <Button variant="ghost" size="sm" onClick={availability.retry}>
          Retry
        </Button>
      )}
    </p>
  );
  if (screen === 'recordedDay')
    return (
      <>
        {schedule && (
          <p className="wk-hint wk-range-hint">This workflow has a schedule, so its footage day moves with each run.</p>
        )}
        {errors}
        <SettingsChoices
          label="Recorded days"
          options={[
            ...dayOptions.map(([value, day]) => ({
              value,
              label: day.label,
              description:
                value === 'run-day' && limit ? `Window must end by ${limit} UTC` : 'For scheduled or repeated runs',
            })),
            ...(schedule ? [] : days.map(day => ({ value: day, label: dayLabel(day) }))),
          ]}
          value={data.day}
          onChoose={day => {
            onChange({ ...data, day, ...(isRelativeDay(day) ? {} : { from: '', until: '' }) });
            onNavigate('overview');
          }}
          empty={availability.loading ? 'Loading recorded dates…' : 'No footage is available for this camera.'}
        />
      </>
    );
  if (screen === 'sampling')
    return (
      <SettingsChoices
        label="Frame intervals"
        options={[1, 2, 5, 10, 30, 60].map(value => ({
          value: String(value),
          label: `Every ${value} second${value === 1 ? '' : 's'}`,
        }))}
        value={String(data.interval)}
        onChoose={value => {
          onChange({ ...data, interval: Number(value) });
          onNavigate('overview');
        }}
      />
    );
  if (screen === 'frameChoice')
    return (
      <SettingsChoices
        label="Frame kept"
        options={[
          { value: 'first', label: 'First frame', description: 'The frame at each tick. Fastest to decode.' },
          {
            value: 'change',
            label: 'Most change',
            description:
              'Reads every frame and keeps the one with the most new light, so short events like meteors are ' +
              'caught. Also follows each saved object through every frame.',
          },
        ]}
        value={data.pick ?? 'first'}
        onChoose={value => {
          onChange({ ...data, pick: value as 'first' | 'change' });
          onNavigate('overview');
        }}
      />
    );
  if (screen === 'timeRange' && relative)
    return (
      <>
        <p className="wk-hint wk-range-hint">
          Applies to each run’s day.{endBy ? ` Ends by ${endBy} UTC for the ${schedule!.at} UTC schedule.` : ''}
          {first ? ` ${dayLabel(day)} has recordings ${minimum}–${maximum}.` : ''}
        </p>
        <div className="wk-field-pair">
          <label className="wk-field">
            <span>From</span>
            <Input type="time" step="1" value={from} onChange={event => setFrom(event.target.value)} />
          </label>
          <label className="wk-field">
            <span>Until</span>
            <Input
              type="time"
              step="1"
              value={until}
              max={endBy || undefined}
              onChange={event => setUntil(event.target.value)}
            />
          </label>
        </div>
        <div className="wk-form-actions">
          <Button size="sm" variant="secondary" onClick={() => apply()}>
            Apply range
          </Button>
        </div>
        {errors}
      </>
    );
  if (screen === 'timeRange')
    return (
      <>
        {loading ? (
          <LoadingStatus>Loading recorded windows…</LoadingStatus>
        ) : first ? (
          <>
            <p className="wk-hint wk-range-hint">
              Available {minimum}–{maximum}. Gaps are skipped.
            </p>
            <div className="wk-field-pair">
              <label className="wk-field">
                <span>From</span>
                <Input
                  type="time"
                  step="1"
                  value={from}
                  min={minimum}
                  max={maximum}
                  onChange={event => setFrom(event.target.value)}
                />
              </label>
              <label className="wk-field">
                <span>Until</span>
                <Input
                  type="time"
                  step="1"
                  value={until}
                  min={minimum}
                  max={maximum}
                  onChange={event => setUntil(event.target.value)}
                />
              </label>
            </div>
            <div className="wk-form-actions">
              <Button size="sm" variant="secondary" onClick={() => apply()}>
                Apply range
              </Button>
              <Button size="sm" variant="ghost" onClick={() => apply(minimum, maximum)}>
                Use recorded window
              </Button>
            </div>
          </>
        ) : (
          <p className="wk-hint">No recorded window is available.</p>
        )}
        {errors}
      </>
    );
  if (screen === 'sourcePreview')
    return summary.clips.length ? (
      <div className="wk-source-preview">
        <video
          controls
          playsInline
          preload="metadata"
          src={videoUrl(camera, summary.clips[0])}
          aria-label="Source recording preview"
        />
        <dl>
          <div>
            <dt>Video</dt>
            <dd>{formatDuration(summary.seconds)}</dd>
          </div>
          <div>
            <dt>Source files</dt>
            <dd>
              {summary.clips.length} · {formatBytes(summary.bytes)}
            </dd>
          </div>
          <div>
            <dt>Sample estimate</dt>
            <dd>~{summary.samples.toLocaleString()} images</dd>
          </div>
        </dl>
      </div>
    ) : (
      <p className="wk-hint">Choose a recorded time range first.</p>
    );
  return (
    <>
      {!camera && <p className="wk-hint wk-range-hint">Choose a camera in the source step first.</p>}
      <SettingsRow
        label="Recorded day · UTC"
        value={data.day ? dayLabel(data.day) : 'Choose a recorded day'}
        disabled={!camera}
        onClick={() => onNavigate('recordedDay')}
      />
      <SettingsRow
        label="Time range · UTC"
        value={
          data.from && data.until
            ? `${data.from}–${data.until}`
            : loading
              ? 'Loading recorded windows…'
              : 'Choose a time range'
        }
        disabled={!data.day || loading}
        onClick={() => onNavigate('timeRange')}
      />
      <SettingsRow
        label="Extract one frame"
        value={`Every ${data.interval} second${data.interval === 1 ? '' : 's'}`}
        onClick={() => onNavigate('sampling')}
      />
      <SettingsRow
        label="Frame kept"
        value={data.pick === 'change' ? 'Most change' : 'First frame'}
        onClick={() => onNavigate('frameChoice')}
      />
      {schedule && data.day && !relative && (
        <p className="wk-error wk-hint" role="alert">
          This workflow has a schedule. Choose Day of each run or Day before each run.
        </p>
      )}
      {endBy !== null && data.until && fullTime(data.until) > endBy && (
        <p className="wk-error wk-hint" role="alert">
          {endBy
            ? `End the window by ${endBy} UTC${schedule?.trigger === 'time' ? ', or schedule later' : ''}.`
            : 'This schedule runs too early for Day of each run. Use Day before each run.'}
        </p>
      )}
      {summary.clips.length > 0 && (
        <Button variant="ghost" size="sm" className="wk-source-summary" onClick={() => onNavigate('sourcePreview')}>
          {summary.clips.length} clips · ~{summary.samples.toLocaleString()} images
          {relative ? ` on ${dayLabel(day)}` : ''} →
        </Button>
      )}
      {errors}
    </>
  );
}
