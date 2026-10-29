import { BrandIndicator, LoadingStatus } from './components/brand-indicator';
import { BrandLogo } from './components/brand-logo';
import { createPortal } from 'react-dom';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Keyboard,
  LogOut,
  Moon,
  RefreshCw,
  SkipForward,
  Sun,
  X,
} from 'lucide-react';
import { useArchive } from './hooks/use-archive';
import { useAvailableDays } from './hooks/use-available-days';
import { useCompactLayout, useLandscapeLayout } from './hooks/use-compact-layout';
import { Viewer, type ViewerHandle } from './components/viewer';
import { Activity } from './components/archive-views';
import { RecordingBrowser } from './components/recording-browser';
import { MobileRecordingSheet } from './components/mobile-recording-sheet';
import { MobileNavigation } from './components/mobile-navigation';
const Workshop = lazy(() => import('./features/workshop/Workshop'));
import { useAppearance } from './hooks/use-appearance';
import { pushPage } from './hooks/use-back-to-close';
const ApiAccess = lazy(() => import('./components/api-access').then(module => ({ default: module.ApiAccess })));
const DateBrowser = lazy(() => import('./components/date-browser').then(module => ({ default: module.DateBrowser })));
import { ToolButton } from './components/tool-button';
import { Button } from './components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './components/ui/popover';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { clockTime, dateLabel, dayKey, nearestRecording } from './lib/archive/recordings.js';
import { adjacentRecordedDay, recordedRange } from './lib/archive-navigation';
import { formatAge, formatBitrate, formatBytes, formatDuration, formatInteger } from './lib/archive/format.js';
import type { ReviewRange, Segment, Zone } from './lib/types';

function workshopLocation() {
  return ['workshop', 'models'].includes(new URLSearchParams(location.search).get('view') ?? '');
}
export default function App() {
  const [workshop, setWorkshop] = useState(workshopLocation);
  const { theme, setTheme } = useAppearance();
  useEffect(() => {
    const sync = () => setWorkshop(workshopLocation());
    window.addEventListener('popstate', sync);
    window.addEventListener('skyvision:navigate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('skyvision:navigate', sync);
    };
  }, []);
  function leaveWorkshop(view: 'recordings' | 'activity' | 'api') {
    const url = new URL(location.href);
    for (const key of [
      'section',
      'workflow',
      'bucket',
      'model',
      'modelsTab',
      'modelSection',
      'modelMode',
      'modelQuery',
      'modelFilter',
      'modelSort',
    ])
      url.searchParams.delete(key);
    if (view === 'recordings') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    pushPage({}, url);
    setWorkshop(false);
  }
  return workshop ? (
    <Suspense fallback={<LoadingStatus className="api-empty">Loading Workshop…</LoadingStatus>}>
      <Workshop theme={theme} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} onExit={leaveWorkshop} />
    </Suspense>
  ) : (
    <ArchiveApp theme={theme} setTheme={setTheme} />
  );
}
function ArchiveApp({ theme, setTheme }: { theme: string; setTheme: (theme: string) => void }) {
  const a = useArchive();
  const compact = useCompactLayout();
  const landscape = useLandscapeLayout();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [focusTime, setFocusTime] = useState(false);
  const browserReturnFocus = useRef<HTMLElement | null>(null);
  const onFullscreenChange = useCallback((full: boolean) => {
    setFullscreen(full);
    if (!full) setBrowserOpen(false);
  }, []);
  const { route, selection, cam, day, segments, overview } = a;
  const availability = useAvailableDays(cam, route.zone, overview?.generated_at);
  const segment = selection?.segment ?? null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [range, setRange] = useState<ReviewRange | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('skyvision-review-range') ?? 'null');
      const at = route.at ? Date.parse(route.at) + route.offset * 1000 : NaN;
      return saved?.day === route.day &&
        saved?.zone === route.zone &&
        saved?.cam === cam &&
        Number.isFinite(saved.from) &&
        Number.isFinite(saved.to) &&
        saved.from < saved.to &&
        at >= saved.from &&
        at < saved.to
        ? { from: saved.from, to: saved.to }
        : null;
    } catch {
      return null;
    }
  });
  const previousContext = useRef(`${route.day}/${route.zone}/${cam}`);
  const [expanded, setExpanded] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(() => {
    try {
      const values = JSON.parse(localStorage.getItem('skyvision-saved') ?? '[]');
      return new Set(Array.isArray(values) ? values.filter(v => typeof v === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const video = useRef<ViewerHandle>(null);
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    const syncMotion = () => document.documentElement.toggleAttribute('data-motion-paused', document.hidden);
    syncMotion();
    document.addEventListener('visibilitychange', syncMotion);
    return () => {
      document.removeEventListener('visibilitychange', syncMotion);
      document.documentElement.removeAttribute('data-motion-paused');
    };
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.title = `${route.view === 'models' ? 'Models' : route.view === 'api' ? 'API access' : route.view === 'activity' ? 'Activity' : 'Recordings'} · openskycam`;
  }, [route.view]);
  useEffect(() => {
    const context = `${route.day}/${route.zone}/${cam}`;
    if (context !== previousContext.current) {
      setRange(null);
      previousContext.current = context;
    }
  }, [route.day, route.zone, cam]);
  useEffect(() => {
    try {
      if (range)
        localStorage.setItem(
          'skyvision-review-range',
          JSON.stringify({ ...range, day: route.day, zone: route.zone, cam }),
        );
      else localStorage.removeItem('skyvision-review-range');
    } catch {
      /* Range selection remains available without browser storage. */
    }
  }, [range, route.day, route.zone, cam]);
  const index = segments.findIndex(s => s.start === segment?.start);
  const isSaved = Boolean(segment && saved.has(`${cam}/${segment.start}`));
  const previousDay = adjacentRecordedDay(availability.days, route.day, -1);
  const nextDay = adjacentRecordedDay(availability.days, route.day, 1);
  // The server measured the age; only the time since its answer arrived is counted here, so a computer whose
  // clock is off neither hides nor invents footage.
  const received = useMemo(() => Date.now(), [overview]);
  const uploadAge =
    overview?.health.age_seconds != null ? overview.health.age_seconds + Math.max(0, now - received) / 1000 : null;
  const health = uploadAge === null ? 'Waiting for footage' : `Last upload ${formatAge(uploadAge)}`;
  const changeDate = (key: string) => {
    if (availability.days?.has(key)) {
      a.changeDay(key);
      setDateOpen(false);
    }
  };
  const selectRecording = useCallback(
    (s: Segment, play = true, offset = 0) => {
      const time = Date.parse(s.start) + offset * 1000;
      if (range && (time < range.from || time >= range.to)) setRange(null);
      a.select(s, play, offset);
    },
    [a.select, range],
  );
  const step = (offset: number) => {
    const target = segments[index + offset];
    if (target) selectRecording(target);
  };
  const seek = useCallback(
    (date: Date, play = true) => {
      const found = nearestRecording(segments, date);
      if (!found?.exact) return notify(`No footage at ${clockTime(date, route.zone, true)}. Choose a recorded time.`);
      selectRecording(found.segment, play, found.offset);
    },
    [segments, route.zone, selectRecording, notify],
  );
  useEffect(() => {
    if (selection) setPlayhead(Date.parse(selection.segment.start) + selection.offset * 1000);
  }, [selection?.id]);
  const onProgress = useCallback(
    (start: string, offset: number, exact = false) => {
      a.trackProgress(start, offset, exact);
      setPlayhead(Date.parse(start) + Math.floor(offset) * 1000);
    },
    [a.trackProgress],
  );
  const changeRange = (next: ReviewRange | null) => {
    if (!next) {
      setRange(null);
      return;
    }
    next = recordedRange(segments, next.from, next.to);
    if (!next) return notify('No recordings in that range. Choose another time.');
    const overlapping = segments.filter(
      s => Date.parse(s.start) < next.to && Date.parse(s.start) + (s.duration_s ?? 60) * 1000 > next.from,
    );
    const boundary = nearestRecording(overlapping, new Date(next.from));
    const first = boundary?.exact ? boundary.segment : overlapping[0];
    if (!first) return notify('No recordings in that range. Choose another time.');
    setRange(next);
    const position = a.playbackPosition.current;
    const current = Date.parse(position.start) + position.offset * 1000;
    if (current >= next.from && current < next.to) return;
    if (first) a.select(first, false, Math.max(0, (next.from - Date.parse(first.start)) / 1000));
  };
  function toggleSave() {
    if (!segment) return;
    const next = new Set(saved);
    const key = `${cam}/${segment.start}`;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    try {
      localStorage.setItem('skyvision-saved', JSON.stringify([...next]));
      setSaved(next);
      notify(next.has(key) ? 'Saved on this device. Archive retention is unchanged.' : 'Removed from saved clips.');
    } catch {
      notify('This browser could not save the bookmark.');
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      notify('Recording link copied.');
    } catch {
      notify('Could not copy the link. Copy the address from your browser.');
    }
  }
  const details = () => {
    setBrowserOpen(false);
    setDetailsOpen(true);
  };
  // The same recording at the same moment, shown in the other time zone.
  const changeZone = (zone: Zone) =>
    a.changeDay(
      segment ? dayKey(new Date(segment.start), zone) : route.day,
      zone,
      segment?.start ?? null,
      false,
      segment && a.playbackPosition.current.start === segment.start ? a.playbackPosition.current.offset : 0,
    );
  function browseRecordings(exactTime = false) {
    browserReturnFocus.current = document.activeElement as HTMLElement;
    setFocusTime(exactTime);
    setBrowserOpen(true);
  }
  function findTime() {
    if (compact || fullscreen) browseRecordings(true);
    else {
      setExpanded(false);
      requestAnimationFrame(() => search.current?.focus());
    }
  }
  useEffect(() => {
    if ((!compact && !fullscreen) || route.view !== 'recordings') setBrowserOpen(false);
  }, [compact, fullscreen, route.view]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      // A control that handled the key, such as the minute picker's arrows, keeps it from the player.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || shortcuts || route.view !== 'recordings') return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="slider"]',
        )
      )
        return;
      if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        video.current?.panBy(
          e.key === 'ArrowLeft' ? -60 : e.key === 'ArrowRight' ? 60 : 0,
          e.key === 'ArrowUp' ? -60 : e.key === 'ArrowDown' ? 60 : 0,
        );
        return;
      }
      const key = e.key.toLowerCase();
      if (
        ![
          ' ',
          'k',
          'j',
          'l',
          'arrowleft',
          'arrowright',
          'i',
          'o',
          'r',
          '[',
          ']',
          'm',
          'f',
          '/',
          '?',
          '+',
          '=',
          '-',
          '0',
        ].includes(key) ||
        (key === ' ' && target.closest('button'))
      )
        return;
      e.preventDefault();
      if (key === ' ' || key === 'k') video.current?.toggle();
      if (['j', 'l', 'arrowleft', 'arrowright'].includes(key))
        video.current?.skip(key === 'j' || key === 'arrowleft' ? -1 : 1);
      if (key === 'i' || key === 'o') video.current?.markLoop(key === 'i' ? 'from' : 'to');
      if (key === 'r') video.current?.toggleLoop();
      if (key === '[' || key === ']') step(key === '[' ? -1 : 1);
      if (key === 'm') video.current?.mute();
      if (key === 'f') video.current?.fullscreen();
      if (key === '/') void findTime();
      if (key === '+' || key === '=') video.current?.zoomBy(0.25);
      if (key === '-') video.current?.zoomBy(-0.25);
      if (key === '0') video.current?.resetZoom();
      if (key === '?') setShortcuts(true);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [shortcuts, route.view, index, segments, range, compact, fullscreen]);
  const onActivityDay = useCallback(
    (key: string) => {
      if (overview?.days.some(day => day.day === key && day.segments > 0)) a.changeDay(key, 'UTC');
    },
    [a.changeDay, overview],
  );
  const onActivityClip = useCallback(
    (s: Segment) => {
      a.select(s);
    },
    [a.changeView, a.select],
  );
  const recordingBrowser = (
    <RecordingBrowser
      dayKey={route.day}
      zone={route.zone}
      cam={cam}
      segments={segments}
      selected={segment}
      playhead={playhead}
      loading={a.loading}
      saved={saved}
      range={range}
      searchRef={search}
      browseOnly={compact || fullscreen}
      onSelect={s => {
        selectRecording(s, true, range ? Math.max(0, (range.from - Date.parse(s.start)) / 1000) : 0);
        setBrowserOpen(false);
      }}
      onSeek={time => {
        seek(time);
        setBrowserOpen(false);
      }}
      onRange={changeRange}
      notify={notify}
    />
  );
  const dateControl = (
    <Popover open={dateOpen} onOpenChange={setDateOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="date-button"
          aria-label={`Choose recording date, ${dateLabel(day, route.zone)}${route.zone === 'UTC' ? ', UTC' : ''}`}
        >
          <CalendarDays />
          <span>
            {compact
              ? new Intl.DateTimeFormat('en-US', {
                  month: 'short',
                  day: 'numeric',
                  ...(route.zone === 'UTC' ? { timeZone: 'UTC' } : {}),
                }).format(day)
              : dateLabel(day, route.zone)}
          </span>
          {route.zone === 'UTC' && <small>UTC</small>}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Recording date"
        align={compact ? 'center' : 'start'}
        collisionPadding={12}
        className="calendar-popover"
      >
        <Suspense fallback={<LoadingStatus className="calendar-loading">Loading calendar…</LoadingStatus>}>
          <DateBrowser
            value={route.day}
            zone={route.zone}
            availability={availability}
            onChange={changeDate}
            onZone={changeZone}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
  const latestControl = (
    <Button
      variant={compact ? 'ghost' : 'secondary'}
      className="latest-button"
      aria-label="Open latest recording"
      disabled={!overview?.health.newest_start}
      onClick={() => {
        setRange(null);
        void a.latest();
      }}
    >
      <SkipForward />
      <span>Latest</span>
    </Button>
  );

  return (
    <div className="app-shell" data-landscape={(landscape && route.view === 'recordings') || undefined}>
      <a
        href={route.view === 'models' ? '#model-library' : route.view === 'api' ? '#api-access' : '#review'}
        className="skip-link"
      >
        Skip to content
      </a>
      {compact ? (
        <header className="app-header mobile-header">
          <MobileNavigation
            view={route.view}
            email={overview?.viewer.email}
            cameras={overview?.cameras ?? []}
            camera={cam}
            theme={theme}
            busy={a.refreshing || a.loading}
            refreshing={a.refreshing}
            health={health}
            onView={a.changeView}
            onCamera={a.changeCamera}
            onRefresh={() => void a.refresh()}
            onAppearance={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            onShortcuts={() => setShortcuts(true)}
          />
          <div className="mobile-header-context">
            {route.view === 'recordings' ? (
              dateControl
            ) : (
              <span>{route.view === 'models' ? 'Models' : route.view === 'api' ? 'API access' : 'Activity'}</span>
            )}
          </div>
          {latestControl}
        </header>
      ) : (
        <header className="app-header">
          <div className="brand-group">
            <a href="/" className="brand" aria-label="openskycam home">
              <BrandLogo decorative />
            </a>
            {(overview?.cameras.length ?? 0) > 1 && (
              <select
                className="camera-select"
                aria-label="Camera"
                value={cam}
                onChange={e => a.changeCamera(e.target.value)}
              >
                {overview?.cameras.map(camera => (
                  <option key={camera} value={camera}>
                    {camera.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </div>
          <nav aria-label="Main navigation" className="main-nav">
            <Button
              variant="ghost"
              className={route.view === 'recordings' ? 'active' : ''}
              aria-current={route.view === 'recordings' ? 'page' : undefined}
              onClick={() => a.changeView('recordings')}
            >
              Recordings
            </Button>
            <Button
              variant="ghost"
              className={route.view === 'activity' ? 'active' : ''}
              aria-current={route.view === 'activity' ? 'page' : undefined}
              onClick={() => a.changeView('activity')}
            >
              Activity
            </Button>
            <Button
              variant="ghost"
              className={route.view === 'models' ? 'active' : ''}
              aria-current={route.view === 'models' ? 'page' : undefined}
              onClick={() => a.changeView('workshop')}
            >
              Workshop
            </Button>
          </nav>
          <div className="header-actions">
            <span className="health-label" title={health}>
              <BrandIndicator state={uploadAge !== null && uploadAge < 180 ? 'live' : 'idle'} />
              {uploadAge !== null && uploadAge < 180 ? 'Receiving footage' : 'No recent footage'}
            </span>
            <ToolButton
              label={a.refreshing ? 'Refreshing' : `Refresh · ${health}`}
              disabled={a.refreshing || a.loading}
              onClick={() => void a.refresh()}
            >
              {a.refreshing ? <BrandIndicator /> : <RefreshCw />}
            </ToolButton>
            <ToolButton
              label={theme === 'dark' ? 'Use light appearance' : 'Use dark appearance'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </ToolButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="account-avatar" aria-label="Account menu">
                  {overview?.viewer.email.slice(0, 1).toUpperCase() ?? 'O'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="menu-content">
                <DropdownMenuLabel>{overview?.viewer.email ?? 'Signed in'}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="mobile-account-action"
                  disabled={a.refreshing || a.loading}
                  onSelect={() => void a.refresh()}
                >
                  <RefreshCw />
                  Refresh recordings
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="mobile-account-action"
                  onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun /> : <Moon />}
                  {theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => a.changeView('api')}>
                  <KeyRound />
                  API access
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShortcuts(true)}>
                  <Keyboard />
                  Keyboard shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/cdn-cgi/access/logout">
                    <LogOut />
                    Sign out
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
      )}
      {a.error && (
        <div className="error-banner" role="alert">
          <span>{a.sessionExpired ? 'Your session has expired. Sign in again to continue.' : a.error.message}</span>
          <Button variant="ghost" onClick={() => (a.sessionExpired ? location.reload() : void a.refresh())}>
            {a.sessionExpired ? 'Sign in' : 'Retry'}
          </Button>
        </div>
      )}
      <main
        className={`review-view${expanded && !compact ? ' is-expanded' : ''}`}
        hidden={route.view !== 'recordings'}
        id="review"
        tabIndex={-1}
      >
        <h1 className="sr-only">Recordings</h1>
        {!compact && (
          <div className="workspace-toolbar">
            <div className="date-navigation">
              <ToolButton
                label="Previous recorded day"
                disabled={!previousDay}
                onClick={() => previousDay && changeDate(previousDay)}
              >
                <ChevronLeft />
              </ToolButton>
              {dateControl}
              <ToolButton label="Next recorded day" disabled={!nextDay} onClick={() => nextDay && changeDate(nextDay)}>
                <ChevronRight />
              </ToolButton>
            </div>
            <div className="workspace-meta">{latestControl}</div>
          </div>
        )}
        <div className="review-grid">
          <div className="review-main">
            <Viewer
              ref={video}
              controlsHost={controlsHost}
              selection={selection}
              cam={cam}
              zone={route.zone}
              day={day}
              segments={segments}
              range={range}
              onRange={changeRange}
              onSeek={seek}
              onProgress={onProgress}
              loading={a.loading}
              loadFailed={Boolean(a.error)}
              active={route.view === 'recordings'}
              previous={index > 0}
              next={index >= 0 && index < segments.length - 1}
              saved={isSaved}
              expanded={expanded}
              onStep={step}
              onSave={toggleSave}
              onCopy={() => void copyLink()}
              onDetails={details}
              onExpand={() => setExpanded(!expanded)}
              onFindTime={findTime}
              onBrowse={() => browseRecordings()}
              browsing={browserOpen || dateOpen || detailsOpen || shortcuts}
              onFullscreenChange={onFullscreenChange}
            />
          </div>
          {compact || fullscreen ? (
            <div className="mobile-review-footer">
              <MobileRecordingSheet
                availability={availability}
                fullscreen={fullscreen || landscape}
                returnFocus={browserReturnFocus}
                initialFocus={focusTime ? search : undefined}
                open={browserOpen}
                onOpenChange={open => {
                  setBrowserOpen(open);
                  if (!open) setFocusTime(false);
                }}
                day={day}
                dayKey={route.day}
                zone={route.zone}
                count={segments.length}
                onDate={changeDate}
                onZone={changeZone}
              >
                {recordingBrowser}
              </MobileRecordingSheet>
              <div className="player-controls-shelf" ref={setControlsHost} />
            </div>
          ) : (
            recordingBrowser
          )}
        </div>
      </main>
      {route.view === 'activity' && (
        <Activity
          overview={overview}
          day={day}
          zone={route.zone}
          segments={segments}
          selected={segment}
          onDay={onActivityDay}
          onClip={onActivityClip}
        />
      )}
      {route.view === 'api' && (
        <Suspense fallback={<LoadingStatus className="api-empty">Loading API access…</LoadingStatus>}>
          <ApiAccess />
        </Suspense>
      )}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="recording-details-dialog">
          <DialogTitle>Recording details</DialogTitle>
          <DialogDescription>
            {segment
              ? `${clockTime(new Date(segment.start), route.zone, true)} · ${dateLabel(new Date(segment.start), route.zone)} · ${route.zone === 'UTC' ? 'UTC' : 'Local time'}`
              : 'Select a recording first.'}
          </DialogDescription>
          {segment && (
            <dl>
              {[
                ['Duration', segment.duration_s === null ? 'Unknown' : formatDuration(segment.duration_s)],
                ['File size', formatBytes(segment.size)],
                ['Resolution', segment.width && segment.height ? `${segment.width} × ${segment.height}` : 'Unknown'],
                ['Codec', segment.codec?.toUpperCase() ?? 'Unknown'],
                ['Frames', segment.frames === null ? 'Unknown' : formatInteger(segment.frames)],
                ['Bitrate', segment.bitrate ? formatBitrate(segment.bitrate) : 'Unknown'],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="shortcuts-dialog">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Review recordings without leaving the player.</DialogDescription>
          <dl>
            {[
              ['Play or pause', 'Space / K'],
              ['Back / forward by skip interval', '← / → or J / L'],
              ['Mark loop start / end', 'I / O'],
              ['Toggle section loop', 'R'],
              ['Previous / next clip', '[ / ]'],
              ['Mute audio', 'M'],
              ['Full screen', 'F'],
              ['Zoom video in / out', '+ / −'],
              ['Reset video zoom', '0'],
              ['Pan enlarged video', 'Shift + arrows'],
              ['Find a recording', '/'],
              ['Show shortcuts', '?'],
            ].map(([action, key]) => (
              <div key={key}>
                <dt>{action}</dt>
                <dd>
                  <kbd>{key}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
      {notice &&
        createPortal(
          <div className="toast" role="status">
            {notice}
            <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <X />
            </Button>
          </div>,
          document.fullscreenElement ?? document.body,
        )}
    </div>
  );
}
