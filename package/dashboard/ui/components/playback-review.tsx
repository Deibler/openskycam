import { useEffect, useRef, type RefObject } from 'react';
import { Pause, Play, Repeat2, RotateCcw, RotateCw } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { Slider } from './ui/slider';
import { ToolButton } from './tool-button';

export const SKIP_INTERVALS = [1, 5, 10, 30] as const;
export const PLAYBACK_SPEEDS = ['0.25', '0.5', '1', '1.5', '2', '4', '8', '16'];
export type ClipLoop = { from: number | null; to: number | null; enabled: boolean };
export const EMPTY_LOOP: ClipLoop = { from: null, to: null, enabled: false };
export function clipTime(seconds: number) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

export function SeekButton({
  seconds,
  onClick,
  disabled,
}: {
  seconds: number;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <ToolButton
      className="seek-button"
      label={`${seconds < 0 ? 'Back' : 'Forward'} ${Math.abs(seconds)} seconds`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="seek-symbol" aria-hidden="true">
        {seconds < 0 ? <RotateCcw /> : <RotateCw />}
        <span>{Math.abs(seconds)}</span>
      </span>
    </ToolButton>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLDivElement | null>;
  skip: number;
  onSkip: (seconds: number) => void;
  loop: ClipLoop;
  time: number;
  min: number;
  max: number;
  ready: boolean;
  onLast: (seconds: number) => void;
  onMark: (edge: 'from' | 'to') => void;
  onBounds: (from: number, to: number) => void;
  onToggle: () => void;
  onClear: () => void;
};

export function PlaybackReview(p: Props) {
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (p.open) returnFocus.current = document.activeElement as HTMLElement;
  }, [p.open]);
  const canLoop = p.ready && p.max - p.min >= 0.1;
  const from = p.loop.from ?? Math.max(p.min, p.time - p.skip);
  const to = p.loop.to ?? Math.min(p.max, Math.max(from + 0.1, p.time));
  const hasBounds = p.loop.from !== null && p.loop.to !== null;
  return (
    <Popover open={p.open} onOpenChange={p.onOpenChange}>
      <PopoverAnchor virtualRef={p.anchor} />
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="playback-review-popover"
        aria-label="Replay and skip settings"
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = returnFocus.current;
          if (target?.isConnected) target.focus({ preventScroll: true });
          else p.anchor.current?.querySelector<HTMLButtonElement>('.play-button')?.focus({ preventScroll: true });
        }}
      >
        <div className="review-skip-section">
          <h2>Skip interval</h2>
          <div className="skip-presets" role="group" aria-label="Skip interval">
            {SKIP_INTERVALS.map(seconds => (
              <Button key={seconds} variant="ghost" aria-pressed={p.skip === seconds} onClick={() => p.onSkip(seconds)}>
                {seconds}s
              </Button>
            ))}
          </div>
        </div>
        <div className="review-loop-section">
          <div className="replay-heading">
            <h2>
              <Repeat2 />
              Loop section
            </h2>
            <span>This recording</span>
          </div>
          <div className="replay-presets">
            {[5, 10].map(seconds => (
              <Button
                key={seconds}
                variant="secondary"
                disabled={!canLoop || p.time - p.min < 0.1}
                onClick={() => {
                  p.onLast(seconds);
                  p.onOpenChange(false);
                }}
              >
                Loop last {seconds}s
              </Button>
            ))}
          </div>
          <div className="loop-markers">
            <Button
              variant="ghost"
              disabled={!canLoop}
              onClick={() => p.onMark('from')}
              aria-label="Set loop start at playhead"
            >
              <span>
                Start <kbd>I</kbd>
              </span>
              <strong>{p.loop.from === null ? 'Set here' : clipTime(p.loop.from)}</strong>
            </Button>
            <Button
              variant="ghost"
              disabled={!canLoop || p.loop.from === null || p.time - p.loop.from < 0.1}
              onClick={() => {
                p.onMark('to');
                p.onOpenChange(false);
              }}
              aria-label="Set loop end at playhead"
            >
              <span>
                End <kbd>O</kbd>
              </span>
              <strong>{p.loop.to === null ? 'Set here' : clipTime(p.loop.to)}</strong>
            </Button>
          </div>
          {hasBounds && (
            <div className="loop-adjustment">
              <Slider
                min={p.min}
                max={Math.max(p.min + 0.1, p.max)}
                minStepsBetweenThumbs={1}
                step={0.1}
                value={[from, to]}
                thumbLabels={['Loop start', 'Loop end']}
                thumbValueText={[clipTime(from), clipTime(to)]}
                disabled={!canLoop}
                onValueChange={([start, end]) => p.onBounds(start, end)}
              />
              <p>
                {clipTime(from)} – {clipTime(to)} · {(to - from).toFixed(1)}s
              </p>
            </div>
          )}
          <p className="replay-help">
            {p.loop.from !== null && p.loop.to === null
              ? 'Seek to the end of your section, then press O or set End here.'
              : 'Mark a start and end to replay a section. Your zoom and position stay in place.'}
          </p>
          {(p.loop.from !== null || hasBounds) && (
            <div className="replay-actions">
              <Button
                disabled={!hasBounds || !canLoop}
                onClick={() => {
                  p.onToggle();
                  p.onOpenChange(false);
                }}
              >
                {p.loop.enabled ? <Pause /> : <Play />}
                {p.loop.enabled ? 'Stop looping' : 'Play loop'}
              </Button>
              <Button variant="ghost" onClick={p.onClear}>
                Clear
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
