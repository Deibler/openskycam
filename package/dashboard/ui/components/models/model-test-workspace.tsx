import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Film, Search } from 'lucide-react';
import type { ModelVersion, ModelDeviceDescription } from '../../../src/models/modelInferencemodel';
import type { Overview, Segment, Zone } from '../../lib/types';
import { fetchOverview, fetchSegments, videoUrl } from '../../lib/archive/api.js';
import { addDays, clockTime, dateLabel, parseDay } from '../../lib/archive/recordings.js';
import { formatDuration } from '../../lib/archive/format.js';
import { canDeploy, modelKey, taskLabel } from '../../lib/model-library';
import { useAvailableDays } from '../../hooks/use-available-days';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { LoadingStatus } from '../brand-indicator';

function readSource() {
  const params = new URLSearchParams(location.search);
  return {
    cam: params.get('testCam') ?? params.get('cam') ?? '',
    day: params.get('testDay') ?? params.get('day') ?? '',
    at: params.get('testAt') ?? params.get('at') ?? '',
  };
}

/** Footage preparation is read-only. A synchronized model is not a running test service. */
export function ModelTestWorkspace({
  model,
  devices,
  onBack,
  onDevices,
}: {
  model: ModelVersion;
  devices: ModelDeviceDescription[];
  onBack: () => void;
  onDevices: () => void;
}) {
  const [source, setSource] = useState(readSource);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recordings, setRecordings] = useState<{
    context: string;
    segments: Segment[];
    loading: boolean;
    error: string;
  }>({ context: '', segments: [], loading: true, error: '' });
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const preview = useRef<HTMLVideoElement>(null);
  const zone: Zone = new URLSearchParams(location.search).get('tz') === 'UTC' ? 'UTC' : 'local';
  const cam = overview?.cameras.includes(source.cam) ? source.cam : (overview?.cam ?? '');
  const availability = useAvailableDays(cam, zone, overview?.generated_at);
  const days = [...(availability.days ?? [])].sort().reverse();
  const day = days.includes(source.day) ? source.day : (days[0] ?? '');
  const context = `${cam}/${day}`;
  const segments = recordings.context === context ? recordings.segments : [];
  const loading = !overview || availability.loading || recordings.context !== context || recordings.loading;
  const selected = segments.find(segment => segment.start === source.at);
  const assigned = devices.filter(device =>
    device.deployment?.models.some(binding => modelKey(binding.model) === modelKey(model)),
  );
  const available = segments.filter(segment => clockTime(new Date(segment.start), zone, true).includes(search.trim()));

  function choose(patch: Partial<typeof source>) {
    const next = { ...source, ...patch };
    const url = new URL(location.href);
    for (const [name, value] of Object.entries({ testCam: next.cam, testDay: next.day, testAt: next.at })) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    history.replaceState(history.state, '', url);
    setSource(next);
    setMediaError('');
  }
  function previewRecording(segment: Segment) {
    choose({ cam, day, at: segment.start });
    if (window.matchMedia('(max-width: 760px)').matches)
      requestAnimationFrame(() => {
        preview.current?.focus({ preventScroll: true });
        preview.current?.scrollIntoView({ block: 'start' });
      });
  }
  useEffect(() => {
    let active = true;
    setError('');
    void fetchOverview(null)
      .then(value => {
        if (active) setOverview(value);
      })
      .catch(error => {
        if (active) setError(error instanceof Error ? error.message : 'Could not load the archive.');
      });
    const pop = () => {
      setSource(readSource());
      setMediaError('');
    };
    window.addEventListener('popstate', pop);
    return () => {
      active = false;
      window.removeEventListener('popstate', pop);
    };
  }, [retry]);
  useEffect(() => {
    if (!cam || !day) return;
    const abort = new AbortController();
    const date = parseDay(day, zone)!;
    setRecordings({ context, segments: [], loading: true, error: '' });
    void fetchSegments(cam, date, addDays(date, 1, zone), abort.signal)
      .then(segments => {
        if (!abort.signal.aborted)
          setRecordings({ context, segments: [...segments].reverse(), loading: false, error: '' });
      })
      .catch(error => {
        if (!abort.signal.aborted)
          setRecordings({
            context,
            segments: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load recordings.',
          });
      });
    return () => abort.abort();
  }, [cam, day, zone, context, retry]);
  const archiveError = error || availability.error || (recordings.context === context ? recordings.error : '');
  const recordingLink = selected ? `/?${new URLSearchParams({ cam, day, tz: zone, at: selected.start })}` : '';

  return (
    <section className="model-test-workspace" aria-labelledby="model-test-title">
      <header className="model-test-heading">
        <Button variant="ghost" className="model-library-back" onClick={onBack}>
          <ArrowLeft />
          Back to model
        </Button>
        <div>
          <p className="model-eyebrow">Test on footage · Preparation</p>
          <h2 id="model-test-title" tabIndex={-1}>
            {model.name}
          </h2>
          <p>
            {taskLabel(model.task)}
            <span aria-hidden="true"> · </span>
            {model.version}
          </p>
        </div>
        <div className="model-test-readiness" aria-label="Test availability">
          <p id="test-run-requirement">Footage preview only. Model test execution is not connected yet.</p>
          <Button disabled aria-describedby="test-run-requirement">
            Run test
          </Button>
        </div>
      </header>
      <div className="model-test-layout">
        <div className="model-test-main">
          <div className="model-test-video">
            {selected ? (
              <video
                ref={preview}
                key={`${cam}/${selected.start}`}
                controls
                playsInline
                preload="metadata"
                aria-label="Selected recording preview"
                src={videoUrl(cam, selected)}
                onError={() =>
                  setMediaError('This recording could not be played. Try another recording or open it in Recordings.')
                }
              />
            ) : (
              <div className="model-test-placeholder">
                <Film />
                <h3>Choose a recording</h3>
                <p>Preview the footage you want to test this model on.</p>
              </div>
            )}
            {mediaError && (
              <p className="model-test-media-error" role="alert">
                {mediaError}
              </p>
            )}
          </div>
          <div className="model-test-video-caption">
            <div>
              <strong>{selected ? clockTime(new Date(selected.start), zone, true) : 'Original footage'}</strong>
              <span>
                {selected
                  ? `${dateLabel(parseDay(day, zone)!, zone)} · ${zone === 'UTC' ? 'UTC' : 'Local time'} · ${formatDuration(selected.duration_s ?? 60)}`
                  : 'Your archive stays available while you prepare a test.'}
              </span>
            </div>
            {selected && (
              <Button variant="ghost" asChild>
                <a href={recordingLink}>
                  Open in Recordings
                  <ArrowUpRight />
                </a>
              </Button>
            )}
          </div>
        </div>
        <aside className="model-test-source" aria-label="Test footage">
          <h3>Footage</h3>
          {overview && overview.cameras.length > 1 && (
            <div className="model-test-field">
              <label id="test-camera-label">Camera</label>
              <Select
                value={cam}
                onValueChange={cam => {
                  choose({ cam, day: '', at: '' });
                  setSearch('');
                }}
              >
                <SelectTrigger aria-labelledby="test-camera-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {overview.cameras.map(camera => (
                    <SelectItem key={camera} value={camera}>
                      {camera}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="model-test-field">
            <label id="test-date-label">
              Recording date <span>{zone === 'UTC' ? 'UTC' : 'Local time'}</span>
            </label>
            <Select
              value={day}
              disabled={!days.length}
              onValueChange={day => {
                choose({ cam, day, at: '' });
                setSearch('');
              }}
            >
              <SelectTrigger aria-labelledby="test-date-label">
                <SelectValue placeholder={availability.loading ? 'Loading dates…' : 'No recorded days'} />
              </SelectTrigger>
              <SelectContent>
                {days.map(day => (
                  <SelectItem key={day} value={day}>
                    {dateLabel(parseDay(day, zone)!, zone)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="model-search model-test-search">
            <Search />
            <span className="sr-only">Find recording time</span>
            <input
              aria-label="Find recording time"
              type="search"
              placeholder="Find a time, e.g. 19:42"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          <div className="model-test-recordings" aria-label="Available recordings">
            {archiveError ? (
              <div className="model-test-empty">
                <p role="alert">{archiveError}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRetry(value => value + 1);
                    availability.retry();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : !availability.loading && availability.days?.size === 0 ? (
              <p className="model-test-empty">No recordings are available for this camera.</p>
            ) : loading ? (
              <LoadingStatus>Loading recordings…</LoadingStatus>
            ) : available.length ? (
              <ul>
                {available.map(segment => (
                  <li key={segment.start}>
                    <button
                      type="button"
                      aria-pressed={selected?.start === segment.start}
                      onClick={() => previewRecording(segment)}
                    >
                      <span>{clockTime(new Date(segment.start), zone, true)}</span>
                      <small>{formatDuration(segment.duration_s ?? 60)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="model-test-empty">
                {search ? 'No recordings match that time.' : 'No recordings on this date.'}
              </p>
            )}
          </div>
          <section className="model-test-device">
            <h3>Device</h3>
            {!canDeploy(model) ? (
              <p>This model needs a runtime adapter.</p>
            ) : assigned.length ? (
              <ul>
                {assigned.map(device => (
                  <li key={device.id}>
                    <strong>{device.id}</strong>
                    <span>
                      {device.status === 'ready' && device.revision === device.reported_revision
                        ? 'Model files synchronized'
                        : device.status === 'error'
                          ? 'Model synchronization failed'
                          : 'Waiting for model synchronization'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>This version is not assigned to a device.</p>
            )}
            <Button variant="ghost" className="model-text-action" onClick={onDevices}>
              Manage devices
              <ArrowUpRight />
            </Button>
          </section>
        </aside>
      </div>
    </section>
  );
}
