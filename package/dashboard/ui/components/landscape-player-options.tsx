import { useRef, useState } from 'react';
import {
  Bookmark,
  Download,
  Info,
  Link,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  Plus,
  Repeat2,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ChevronRight,
  Gauge,
  SlidersHorizontal,
  Film,
} from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { ControlsMode } from '../hooks/use-player-controls';
import { PLAYBACK_SPEEDS } from './playback-review';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ready: boolean;
  previous: boolean;
  next: boolean;
  onStep: (direction: number) => void;
  speed: string;
  onSpeed: (speed: string) => void;
  continuous: boolean;
  onContinuous: (value: boolean) => void;
  muted: boolean;
  onMute: () => void;
  zoom: number;
  onZoom: (amount: number) => void;
  onFit: () => void;
  onFill: () => void;
  mode: ControlsMode;
  onMode: (mode: ControlsMode) => void;
  full: boolean;
  onFullscreen: () => void;
  saved: boolean;
  download?: string;
  onSave?: () => void;
  onCopy: () => void;
  onDetails?: () => void;
  onReplay: () => void;
  onFindTime?: () => void;
};

/** A short settings panel keeps every primary option reachable on a sideways phone. */
export function LandscapePlayerOptions(p: Props) {
  const pending = useRef<(() => void) | null>(null);
  const [page, setPage] = useState<'home' | 'playback' | 'view' | 'recording'>('home');
  function action(run: () => void) {
    pending.current = run;
    p.onOpenChange(false);
  }
  const title = { home: 'Options', playback: 'Playback', view: 'View', recording: 'Recording' }[page];
  return (
    <Popover
      open={p.open}
      onOpenChange={open => {
        if (open) setPage('home');
        p.onOpenChange(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="tool-button" aria-label="More recording options">
          <MoreHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={title}
        className="landscape-player-options"
        panelBack={page === 'home' ? undefined : () => setPage('home')}
        onCloseAutoFocus={event => {
          if (pending.current) {
            event.preventDefault();
            const run = pending.current;
            pending.current = null;
            run();
          }
        }}
      >
        {page === 'home' && (
          <div className="player-options-list">
            <Button variant="ghost" onClick={() => action(p.onReplay)}>
              <Repeat2 />
              Replay and skip
              <ChevronRight />
            </Button>
            <Button variant="ghost" onClick={() => setPage('playback')}>
              <Gauge />
              Playback<span>{p.speed}×</span>
              <ChevronRight />
            </Button>
            <Button variant="ghost" onClick={() => setPage('view')}>
              <SlidersHorizontal />
              View<span>{p.zoom === 1 ? 'Fit' : `${Math.round(p.zoom * 100)}%`}</span>
              <ChevronRight />
            </Button>
            <Button variant="ghost" onClick={() => setPage('recording')}>
              <Film />
              Recording
              <ChevronRight />
            </Button>
          </div>
        )}
        {page === 'playback' && (
          <section>
            <label>
              Speed
              <select aria-label="Playback speed" value={p.speed} onChange={e => p.onSpeed(e.target.value)}>
                {PLAYBACK_SPEEDS.map(value => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            <Button variant="ghost" onClick={p.onMute}>
              {p.muted ? <VolumeX /> : <Volume2 />}
              {p.muted ? 'Unmute audio' : 'Mute audio'}
            </Button>
            <label>
              Continuous playback
              <input type="checkbox" checked={p.continuous} onChange={e => p.onContinuous(e.target.checked)} />
            </label>
            <div className="option-pair">
              <Button variant="ghost" disabled={!p.previous} onClick={() => action(() => p.onStep(-1))}>
                <SkipBack />
                Previous
              </Button>
              <Button variant="ghost" disabled={!p.next} onClick={() => action(() => p.onStep(1))}>
                Next
                <SkipForward />
              </Button>
            </div>
          </section>
        )}
        {page === 'view' && (
          <section>
            <div className="option-zoom">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Zoom out"
                disabled={p.zoom <= 1}
                onClick={() => p.onZoom(-0.5)}
              >
                <Minus />
              </Button>
              <span>{Math.round(p.zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Zoom in"
                disabled={!p.ready || p.zoom >= 8}
                onClick={() => p.onZoom(0.5)}
              >
                <Plus />
              </Button>
            </div>
            <div className="option-pair">
              <Button variant="secondary" onClick={() => action(p.onFit)}>
                Fit frame
              </Button>
              <Button variant="secondary" disabled={!p.ready} onClick={() => action(p.onFill)}>
                Fill screen
              </Button>
            </div>
            <Button variant="ghost" onClick={() => action(p.onFullscreen)}>
              {p.full ? <Minimize /> : <Maximize />}
              {p.full ? 'Exit full screen' : 'Full screen'}
            </Button>
            <label>
              Controls
              <select
                value={p.mode}
                onChange={e => {
                  const value = e.target.value as ControlsMode;
                  action(() => p.onMode(value));
                }}
              >
                <option value="auto">Automatic</option>
                <option value="visible">Always show</option>
                <option value="minimized">Minimized</option>
              </select>
            </label>
          </section>
        )}
        {page === 'recording' && (
          <section>
            {p.onFindTime && (
              <Button variant="ghost" onClick={() => action(p.onFindTime!)}>
                <Search />
                Find time
              </Button>
            )}
            {p.onSave && (
              <Button variant="ghost" onClick={() => action(p.onSave!)}>
                <Bookmark />
                {p.saved ? 'Unsave' : 'Save recording'}
              </Button>
            )}
            <Button variant="ghost" asChild>
              <a href={p.download} onClick={() => p.onOpenChange(false)}>
                <Download />
                Download
              </a>
            </Button>
            <Button variant="ghost" onClick={() => action(p.onCopy)}>
              <Link />
              Copy link
            </Button>
            {p.onDetails && (
              <Button variant="ghost" onClick={() => action(p.onDetails!)}>
                <Info />
                Details
              </Button>
            )}
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
