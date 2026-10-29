import { BrandIndicator } from './brand-indicator';
import { createPortal } from 'react-dom';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Download,
  Info,
  Link,
  Maximize,
  Minimize,
  MoreHorizontal,
  PanelRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Gauge,
  GripHorizontal,
  ChevronDown,
  SlidersHorizontal,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Grid2X2,
  Repeat2,
} from 'lucide-react';
import { videoUrl, downloadUrl } from '../lib/archive/api.js';
import { clockTime, mediaTime } from '../lib/archive/recordings.js';
import { coverageRanges, snapToFootage } from '../lib/archive-navigation';
import type { ReviewRange, Segment, Selection, Zone } from '../lib/types';
import { ToolButton } from './tool-button';
import { RecordingScrubber, type TimelineMark } from './recording-scrubber';
import {
  PlaybackReview,
  SeekButton,
  EMPTY_LOOP,
  SKIP_INTERVALS,
  PLAYBACK_SPEEDS,
  clipTime,
  type ClipLoop,
} from './playback-review';
import { cachedClip, keepClips } from '../lib/clip-cache';
import { LandscapePlayerOptions } from './landscape-player-options';
import { VideoNavigator } from './video-navigator';
import { useFrameSteps } from '../hooks/use-frame-steps';
import { useVideoViewport } from '../hooks/use-video-viewport';
import { useCompactLayout, useLandscapeLayout } from '../hooks/use-compact-layout';
import { usePlayerControls, type ControlsMode } from '../hooks/use-player-controls';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './ui/dropdown-menu';
// ponytail: HEVC frames per second the browser decodes. This camera's 4K decoded at 184 fps on an M3 Pro
// (VideoToolbox). Faster than that, 8× and 16× step through keyframes on a true clock instead of
// stalling on the decoder. Lower it if fast playback stutters on slower devices.
const DECODE_FPS = 150;
/** Which recording a media slot holds; its src may be an in-memory copy of that recording. */
const clipOf = (media: HTMLVideoElement | null | undefined) => media?.dataset.clip ?? '';
function assign(media: HTMLVideoElement, src: string) {
  media.dataset.clip = src;
  media.src = cachedClip(src)?.url ?? src;
  media.load();
}
function constrained() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return navigator.onLine === false || !!connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '');
}
export type ViewerHandle = {
  focus: (box: number[]) => void;
  toggle: () => void;
  seekBy: (seconds: number) => void;
  skip: (direction: number) => void;
  markLoop: (edge: 'from' | 'to') => void;
  toggleLoop: () => void;
  fullscreen: () => void;
  mute: () => void;
  zoomBy: (amount: number) => void;
  resetZoom: () => void;
  panBy: (x: number, y: number) => void;
};
type Props = {
  controlsHost?: HTMLDivElement | null;
  selection: Selection | null;
  cam: string;
  zone: Zone;
  day: Date;
  segments: Segment[];
  range: ReviewRange | null;
  loading: boolean;
  loadFailed: boolean;
  active: boolean;
  previous: boolean;
  next: boolean;
  saved: boolean;
  expanded: boolean;
  onStep: (offset: number) => void;
  onSeek: (time: Date, play?: boolean) => void;
  onRange: (range: ReviewRange | null) => void;
  onProgress: (start: string, offset: number, exact?: boolean) => void;
  onSave?: () => void;
  onCopy: () => void;
  onDetails?: () => void;
  onExpand: () => void;
  onFindTime?: () => void;
  onBrowse?: () => void;
  browsing: boolean;
  onFullscreenChange: (full: boolean) => void;
  /** Normalized [left, top, right, bottom] boxes drawn over the picture, e.g. a detection at this moment. */
  boxes?: number[][];
  /** Moments to mark on the timeline. */
  marks?: TimelineMark[];
};
export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(p, ref) {
  const video = useRef<HTMLVideoElement | null>(null);
  const mediaSlots = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const activeSlotRef = useRef(0);
  const [activeSlot, setActiveSlot] = useState(0);
  const heldFrame = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const compact = useCompactLayout();
  const landscape = useLandscapeLayout();
  const [menuOpen, setMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [paused, setPaused] = useState(true);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [holdingFrame, setHoldingFrame] = useState(false);
  const [showWait, setShowWait] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(true);
  const [speed, setSpeed] = useState('1');
  const [cacheTick, setCacheTick] = useState(0);
  const trickSeek = useRef(false);
  const [continuous, setContinuous] = useState(true);
  const [prepareDirection, setPrepareDirection] = useState(1);
  const [nativeFull, setNativeFull] = useState(false);
  const [full, setFull] = useState(false);
  const [viewNotice, setViewNotice] = useState('');
  const [skipSeconds, setSkipSeconds] = useState(() => {
    try {
      const seconds = Number(localStorage.getItem('skyvision-skip-seconds'));
      return SKIP_INTERVALS.some(value => value === seconds) ? seconds : 5;
    } catch {
      return 5;
    }
  });
  const [loopState, setLoopState] = useState<ClipLoop & { key: string }>({ ...EMPTY_LOOP, key: '' });
  const viewport = useVideoViewport(video, stage, () => tapVideo(), activeSlot);
  const { zoom, pan, zoomBy, panBy, reset: resetZoom } = viewport;
  const floating = compact || full;
  const immersive = full || landscape;
  const controls = usePlayerControls({
    frame: stage,
    dock,
    enabled: floating,
    zoom,
    playing: !paused,
    ready,
    blocked: menuOpen || optionsOpen || reviewOpen || p.browsing,
  });
  function changeControlsMode(mode: ControlsMode) {
    controls.setMode(mode);
    if (mode === 'minimized') requestAnimationFrame(() => restoreButton.current?.focus({ preventScroll: true }));
  }
  function restoreControls() {
    controls.restore();
    requestAnimationFrame(() =>
      dock.current?.querySelector<HTMLButtonElement>('.play-button')?.focus({ preventScroll: true }),
    );
  }
  const selected = useRef(p.selection);
  selected.current = p.selection;
  const segment = p.selection?.segment;
  const clipStart = segment ? Date.parse(segment.start) : 0;
  const clipFps = segment?.frames && segment.duration_s ? segment.frames / segment.duration_s : 30;
  const loopKey = `${p.cam}/${segment?.start}/${p.range?.from}/${p.range?.to}`;
  const loop = loopState.key === loopKey ? loopState : EMPTY_LOOP;
  // Faster than the decoder can go, play keyframes only. Loops keep native playback for exact edges.
  const trick = Number(speed) >= 8 && clipFps * Number(speed) > DECODE_FPS && !loop.enabled;
  const mediaRate = trick ? 1 : Number(speed);
  const loopMin = Math.max(0, p.range ? (p.range.from - clipStart) / 1000 : 0);
  const loopMax = Math.max(
    loopMin,
    Math.min(duration || segment?.duration_s || 0, p.range ? (p.range.to - clipStart) / 1000 : Infinity),
  );
  const loopRange =
    loop.enabled && loop.from !== null && loop.to !== null
      ? { from: clipStart + loop.from * 1000, to: clipStart + loop.to * 1000 }
      : null;
  const absoluteTime = segment ? Date.parse(segment.start) + time * 1000 : p.day.getTime();
  const steps = useFrameSteps(
    target => seekTo(new Date(target), false, true, true),
    () => {
      void video.current?.play().catch(() => setPaused(true));
    },
  );
  function toggle() {
    steps.cancel();
    if (!segment || !video.current) return;
    if (video.current.paused) void video.current.play().catch(() => setPaused(true));
    else video.current.pause();
  }
  function tapVideo() {
    toggle();
    if (floating && controls.mode === 'auto') controls.restore();
  }
  function fillVideo() {
    const g = viewport.geometry;
    resetZoom();
    viewport.zoomTo(Math.max(g.width / g.imageWidth, g.height / g.imageHeight));
  }
  function mute() {
    if (video.current) video.current.muted = !video.current.muted;
  }
  function offsetNow() {
    const v = video.current;
    return v && segment && clipOf(v) === videoUrl(p.cam, segment) && v.readyState >= 1
      ? v.currentTime
      : (p.selection?.offset ?? 0);
  }
  function setLoop(next: ClipLoop) {
    setLoopState({ ...next, key: loopKey });
  }
  function setSkip(seconds: number) {
    setSkipSeconds(seconds);
    try {
      localStorage.setItem('skyvision-skip-seconds', String(seconds));
    } catch {
      /* Available for this session. */
    }
  }
  function openReview() {
    controls.restore();
    setReviewOpen(true);
  }
  function seekTo(date: Date, play = !video.current?.paused, manual = true, stepping = false) {
    if (!stepping) steps.cancel();
    const v = video.current;
    const offset = (date.getTime() - clipStart) / 1000;
    if (manual && loop.enabled && loop.from !== null && loop.to !== null && (offset < loop.from || offset >= loop.to))
      setLoop({ ...loop, enabled: false });
    const end = v && Number.isFinite(v.duration) ? v.duration : (segment?.duration_s ?? 60);
    if (
      v &&
      segment &&
      clipOf(v) === videoUrl(p.cam, segment) &&
      v.readyState >= 1 &&
      !v.error &&
      offset >= 0 &&
      offset < end
    ) {
      if (stepping) steps.present(v, offset);
      v.currentTime = Math.min(offset, Math.max(0, end - 0.001));
      setTime(v.currentTime);
      p.onProgress(segment.start, v.currentTime, true);
      if (!play) v.pause();
      else if (v.paused) void v.play().catch(() => setPaused(v.paused));
    } else p.onSeek(date, play);
  }
  function seekBy(seconds: number) {
    if (!segment) return;
    const ranges = coverageRanges(p.segments, p.range?.from ?? -Infinity, p.range?.to ?? Infinity);
    const target = snapToFootage(
      ranges,
      (steps.tail() ?? clipStart + offsetNow() * 1000) + seconds * 1000,
      Math.sign(seconds),
    );
    if (target !== null) {
      setPrepareDirection(seconds < 0 ? -1 : 1);
      steps.push(target, !video.current?.paused);
    }
  }
  function playLoop(from: number, to: number) {
    from = Math.max(loopMin, from);
    to = Math.min(loopMax, to);
    if (to - from < 0.099) {
      setViewNotice('Choose an end after the loop start.');
      return;
    }
    setViewNotice('');
    setLoop({ from, to, enabled: true });
    seekTo(new Date(clipStart + from * 1000), true, false);
  }
  function loopLast(seconds: number) {
    const to = Math.min(loopMax, offsetNow());
    playLoop(Math.max(loopMin, to - seconds), to);
  }
  function markLoop(edge: 'from' | 'to') {
    if (!ready || loopMax - loopMin < 0.1) return;
    const position = Math.max(loopMin, Math.min(loopMax, offsetNow()));
    if (edge === 'from') {
      const from = Math.min(loopMax - 0.1, position);
      setLoop({ from, to: null, enabled: false });
      setViewNotice(`Start set at ${clipTime(from)}. Seek to the end, then press O.`);
    } else if (loop.from !== null) {
      playLoop(loop.from, position);
      setViewNotice('');
    }
  }
  function toggleLoop() {
    if (loop.enabled) setLoop({ ...loop, enabled: false });
    else if (loop.from !== null && loop.to !== null) playLoop(loop.from, loop.to);
    else loopLast(skipSeconds);
  }
  function checkBoundary() {
    const v = video.current;
    if (!v || v.paused || v.seeking || !ready || !segment || clipOf(v) !== videoUrl(p.cam, segment) || !v.currentSrc)
      return false;
    if (loop.enabled && loop.from !== null && loop.to !== null && v.currentTime >= Math.min(loop.to, loopMax) - 0.005) {
      seekTo(new Date(clipStart + loop.from * 1000), true, false);
      return true;
    }
    if (p.range && clipStart + v.currentTime * 1000 >= p.range.to) {
      v.pause();
      v.currentTime = Math.max(0, (p.range.to - clipStart) / 1000 - 0.01);
      return true;
    }
    return false;
  }
  async function fullscreen() {
    const v = video.current;
    if (!v || !segment) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewer.current?.requestFullscreen) await viewer.current.requestFullscreen();
      else {
        setNativeFull(true);
        (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
      }
    } catch {
      setViewNotice('Full screen is unavailable in this window.');
      if (!p.expanded) p.onExpand();
    }
  }
  function focus(box: number[]) {
    viewport.zoomTo(Math.max(1, Math.min(8, 0.2 / Math.max(box[2] - box[0], box[3] - box[1]))));
    viewport.centerAt((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
  }
  useImperativeHandle(ref, () => ({
    focus,
    toggle,
    mute,
    seekBy,
    skip: direction => seekBy(direction * skipSeconds),
    markLoop,
    toggleLoop,
    fullscreen,
    zoomBy,
    resetZoom,
    panBy,
  }));
  useLayoutEffect(() => {
    let v = video.current!;
    const target = p.selection;
    const position = target ? Date.parse(target.segment.start) + target.offset * 1000 : NaN;
    if (!steps.accepts(position)) steps.cancel();
    setError('');
    setTime(target?.offset ?? 0);
    setBuffering(false);
    if (!target) {
      for (const media of mediaSlots.current) {
        media?.pause();
        media?.removeAttribute('src');
        media?.load();
      }
      setDuration(0);
      setPaused(true);
      setReady(false);
      setHoldingFrame(false);
      setSeeking(false);
      return;
    }
    const src = videoUrl(p.cam, target.segment);
    if (clipOf(v) !== src || v.error) {
      // Keep the outgoing decoded frame until the incoming frame is available.
      let captured = false;
      if (v.readyState >= 2 && v.videoWidth && v.videoHeight && heldFrame.current) {
        const canvas = heldFrame.current;
        try {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(v, 0, 0);
            captured = true;
          }
        } catch {
          /* Fall back to the initial loading state. */
        }
      }
      const otherSlot = 1 - activeSlotRef.current;
      const prepared = mediaSlots.current[otherSlot];
      if (!nativeFull && clipOf(prepared) === src && prepared!.readyState >= 1 && !prepared!.error) {
        // Promote the already buffered decoder; do not assign src or call load again.
        v.pause();
        v.muted = true;
        v = prepared!;
        video.current = v;
        activeSlotRef.current = otherSlot;
        setActiveSlot(otherSlot);
        v.muted = muted;
        v.playbackRate = mediaRate;
        const atFrame = v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - target.offset) < 0.04;
        setReady(atFrame);
        setHoldingFrame(!atFrame && (captured || holdingFrame));
      } else {
        setHoldingFrame(captured || holdingFrame);
        setReady(false);
        assign(v, src);
      }
      setSeeking(false);
    }
    setDuration(Number.isFinite(v.duration) ? v.duration : (target.segment.duration_s ?? 0));
    if (v.readyState >= 1) {
      const offset = Math.max(
        0,
        Math.min(target.offset, Number.isFinite(v.duration) ? v.duration - 0.001 : target.offset),
      );
      if (steps.pending()) steps.present(v, offset);
      if (Math.abs(v.currentTime - offset) > 0.001) v.currentTime = offset;
    }
    if (target.play) void v.play().catch(() => setPaused(v.paused));
    else v.pause();
    setPaused(v.paused);
  }, [p.selection?.id, p.cam]);
  useEffect(() => {
    // One warm neighbour only. Leave the current clip's buffer and decoder untouched.
    if (!ready || !segment || !p.active || loop.enabled || document.hidden || constrained()) return;
    const index = p.segments.findIndex(s => s.start === segment.start);
    const neighbour = prepareDirection < 0 ? p.segments[index - 1] : continuous ? p.segments[index + 1] : undefined;
    if (
      !neighbour ||
      neighbour.size > 96 * 1024 * 1024 ||
      (p.range &&
        (Date.parse(neighbour.start) >= p.range.to ||
          Date.parse(neighbour.start) + (neighbour.duration_s ?? 60) * 1000 <= p.range.from))
    )
      return;
    const standby = mediaSlots.current[1 - activeSlotRef.current];
    const src = videoUrl(p.cam, neighbour);
    // Once the clip is in memory, move the standby onto that copy: it then never waits on the network.
    if (!standby || (clipOf(standby) === src && standby.getAttribute('src') === (cachedClip(src)?.url ?? src))) return;
    standby.pause();
    standby.muted = true;
    standby.dataset.prepareOffset =
      prepareDirection < 0 ? String(Math.max(0, (neighbour.duration_s ?? 60) - skipSeconds)) : '0';
    assign(standby, src);
  }, [
    ready,
    segment?.start,
    time,
    duration,
    continuous,
    speed,
    p.active,
    p.cam,
    p.segments,
    p.range,
    loop.enabled,
    skipSeconds,
    prepareDirection,
    cacheTick,
  ]);
  useEffect(() => {
    // Download whole clips ahead: more of them at faster speeds, where each lasts only seconds.
    if (!segment || !p.active || document.hidden || constrained()) return;
    const index = p.segments.findIndex(s => s.start === segment.start),
      rate = Number(speed);
    // ponytail: phones get a shorter lookahead; each clip held is ~30 MB of memory.
    const depth = Math.min(compact ? 2 : 3, rate >= 8 ? 3 : rate >= 2 ? 2 : 1);
    const ahead = prepareDirection < 0 ? [-1] : continuous ? Array.from({ length: depth }, (_, i) => i + 1) : [];
    const upcoming = ahead
      .map(step => p.segments[index + step])
      .filter(
        s =>
          s &&
          s.size <= 96 * 1024 * 1024 &&
          (!p.range ||
            (Date.parse(s.start) < p.range.to && Date.parse(s.start) + (s.duration_s ?? 60) * 1000 > p.range.from)),
      );
    const current = videoUrl(p.cam, segment);
    // Keyframe stepping needs the playing clip in memory too; otherwise it keeps streaming.
    const wanted = [...(trick ? [current] : []), ...upcoming.map(s => videoUrl(p.cam, s))];
    keepClips(wanted, wanted.length + 2, () => setCacheTick(tick => tick + 1), [
      current,
      clipOf(mediaSlots.current[1 - activeSlotRef.current]),
    ]);
  }, [segment?.start, p.active, p.cam, p.segments, p.range, speed, trick, continuous, prepareDirection, compact]);
  useEffect(() => {
    // Keyframe stepping: the element plays at 1× while a clock running at the chosen speed seeks it to
    // the latest keyframe it has passed. One seek at a time, so slow decoding shows fewer frames, never a stall.
    const v = video.current;
    if (!trick || paused || !p.active || !segment || !v) return;
    const rate = Number(speed),
      frames = cachedClip(videoUrl(p.cam, segment))?.keyframes;
    let anchor = { media: v.currentTime, wall: performance.now() },
      requested = -1,
      id = 0;
    // Landing anywhere but the requested keyframe means the viewer sought: restart the clock there.
    const seeked = () => {
      if (!trickSeek.current || Math.abs(v.currentTime - requested) > 0.5)
        anchor = { media: v.currentTime, wall: performance.now() };
      trickSeek.current = false;
    };
    const tick = () => {
      id = requestAnimationFrame(tick);
      if (trickSeek.current || v.seeking || v.readyState < 1) return;
      const end = Number.isFinite(v.duration) ? v.duration : (segment.duration_s ?? 60);
      const target = anchor.media + ((performance.now() - anchor.wall) / 1000) * rate;
      const next = target >= end - 0.05 ? end : frames ? (frames.findLast(t => t <= target) ?? 0) : Math.floor(target);
      if (next > v.currentTime + 0.05) {
        trickSeek.current = true;
        requested = next;
        v.currentTime = next;
      }
    };
    v.addEventListener('seeked', seeked);
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      v.removeEventListener('seeked', seeked);
      trickSeek.current = false;
    };
  }, [trick, paused, p.active, segment?.start, p.cam, activeSlot, speed, cacheTick]);
  useEffect(() => {
    const slots = [...mediaSlots.current];
    return () => {
      for (const media of slots) {
        media?.pause();
        media?.removeAttribute('src');
        media?.load();
      }
    };
  }, []);
  const waiting = Boolean(segment && !error && (holdingFrame || (ready && (seeking || (buffering && !paused)))));
  // A held frame already looks continuous, so its notice waits longer than a mid-clip stall.
  useEffect(() => {
    if (!waiting) {
      setShowWait(false);
      return;
    }
    const timer = setTimeout(() => setShowWait(true), holdingFrame ? 900 : 350);
    return () => clearTimeout(timer);
  }, [waiting, holdingFrame]);
  const boundary = useRef(checkBoundary);
  boundary.current = checkBoundary;
  useEffect(() => {
    const v = video.current;
    if (!v || paused || !p.active) return;
    // Inspect each presented frame, so short loops don't wait for the coarse timeupdate event.
    let id = 0;
    let stopped = false;
    const useVideoFrames = typeof v.requestVideoFrameCallback === 'function';
    const tick = () => {
      if (stopped) return;
      boundary.current();
      id = useVideoFrames ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    id = useVideoFrames ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (useVideoFrames) v.cancelVideoFrameCallback(id);
      else cancelAnimationFrame(id);
    };
  }, [paused, p.active, segment?.start, p.cam, activeSlot]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = mediaRate;
  }, [mediaRate, activeSlot]);
  useEffect(() => {
    if (!p.active) {
      steps.cancel();
      video.current?.pause();
    }
  }, [p.active]);
  useEffect(() => {
    steps.cancel();
  }, [p.cam, p.range?.from, p.range?.to]);
  useEffect(() => {
    const update = () => {
      const full = document.fullscreenElement === viewer.current;
      setFull(full);
      p.onFullscreenChange(full);
    };
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [p.onFullscreenChange]);
  useEffect(() => {
    if (viewNotice) {
      const timer = setTimeout(() => setViewNotice(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [viewNotice]);
  useEffect(() => {
    const v = video.current!;
    const end = () => setNativeFull(false);
    v.addEventListener('webkitendfullscreen', end);
    return () => v.removeEventListener('webkitendfullscreen', end);
  }, [activeSlot]);
  // Flush the real media position before navigation/reload, not a stale render value.
  useEffect(() => {
    const save = () => {
      if (selected.current && video.current?.readyState)
        p.onProgress(selected.current.segment.start, video.current.currentTime, true);
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [p.onProgress]);
  const clock = clockTime(new Date(absoluteTime), p.zone, true);
  const moreMenu = (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="tool-button" aria-label="More recording options">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="menu-content"
        onCloseAutoFocus={event => {
          if (reviewOpen) event.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={openReview}>
          <Repeat2 />
          Replay and skip settings
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!p.previous} onSelect={() => p.onStep(-1)}>
          <SkipBack />
          Previous recording
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!p.next} onSelect={() => p.onStep(1)}>
          <SkipForward />
          Next recording
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {p.onFindTime && (
          <DropdownMenuItem onSelect={p.onFindTime}>
            <Search />
            Go to time
          </DropdownMenuItem>
        )}
        {p.onSave && (
          <DropdownMenuItem disabled={!segment} onSelect={p.onSave}>
            <Bookmark />
            {p.saved ? 'Remove saved recording' : 'Save recording'}
          </DropdownMenuItem>
        )}
        {segment && (
          <DropdownMenuItem asChild>
            <a href={downloadUrl(p.cam, segment)}>
              <Download />
              Download original
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="desktop-menu-item" onSelect={p.onExpand}>
          <PanelRight />
          {p.expanded ? 'Show recording browser' : 'Hide recording browser'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!segment} onSelect={p.onCopy}>
          <Link />
          Copy link at this moment
        </DropdownMenuItem>
        {p.onDetails && (
          <DropdownMenuItem disabled={!segment} onSelect={p.onDetails}>
            <Info />
            Recording details
          </DropdownMenuItem>
        )}
        <div className="mobile-menu-controls">
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!segment} onSelect={() => void fullscreen()}>
            <Maximize />
            {full ? 'Exit full screen' : 'Full screen'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!segment} onSelect={mute}>
            {muted ? <Volume2 /> : <VolumeX />}
            {muted ? 'Unmute audio' : 'Mute audio'}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Gauge />
              Playback speed <span className="menu-value">{speed}×</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="menu-content">
              <DropdownMenuRadioGroup value={speed} onValueChange={setSpeed}>
                {PLAYBACK_SPEEDS.map(value => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {value}×{value === '1' ? ' · Normal' : ''}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!ready || zoom >= 8} onSelect={() => zoomBy(0.5)}>
            <ZoomIn />
            Zoom in
          </DropdownMenuItem>
          <DropdownMenuItem disabled={zoom <= 1} onSelect={() => zoomBy(-0.5)}>
            <ZoomOut />
            Zoom out
          </DropdownMenuItem>
          <DropdownMenuItem disabled={zoom <= 1} onSelect={resetZoom}>
            <RotateCcw />
            Fit to player
          </DropdownMenuItem>
        </div>
        {floating && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => changeControlsMode('minimized')}>
              <ChevronDown />
              Minimize controls
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SlidersHorizontal />
                Player controls
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="menu-content">
                <DropdownMenuRadioGroup
                  value={controls.mode}
                  onValueChange={value => changeControlsMode(value as ControlsMode)}
                >
                  <DropdownMenuRadioItem value="auto">Automatic</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="visible">Always visible</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="minimized">Minimized</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={controls.resetPosition}>
                  <RotateCcw />
                  Reset controls position
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={continuous} onCheckedChange={setContinuous}>
          Continuous playback
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const minimizedControls = (
    <div className="minimized-controls" role="group" aria-label="Minimized playback controls">
      <SeekButton seconds={-skipSeconds} onClick={() => seekBy(-skipSeconds)} disabled={!segment} />
      <ToolButton label={paused ? 'Play recording' : 'Pause recording'} onClick={toggle} disabled={!segment}>
        {paused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
      </ToolButton>
      <SeekButton seconds={skipSeconds} onClick={() => seekBy(skipSeconds)} disabled={!segment} />
      <ToolButton ref={restoreButton} label="Show playback controls" onClick={restoreControls}>
        <SlidersHorizontal />
      </ToolButton>
      {immersive && p.onBrowse && (
        <ToolButton label="Browse footage" onClick={p.onBrowse}>
          <Grid2X2 />
        </ToolButton>
      )}
      {full && (
        <ToolButton label="Exit full screen" onClick={() => void fullscreen()}>
          <Minimize />
        </ToolButton>
      )}
    </div>
  );
  return (
    <section
      ref={viewer}
      className={`viewer${controls.minimized ? ' controls-minimized' : ''}`}
      data-landscape={landscape || undefined}
      aria-label="Recording player"
      onPointerMoveCapture={controls.activity}
      onPointerDownCapture={controls.activity}
      onKeyDownCapture={controls.activity}
      onFocusCapture={controls.activity}
      onWheelCapture={controls.activity}
    >
      <div ref={stage} className={`video-stage${zoom > 1 ? ' is-zoomed' : ''}`}>
        {[0, 1].map(slot => (
          <video
            key={slot}
            ref={node => {
              mediaSlots.current[slot] = node;
              if (slot === activeSlotRef.current) video.current = node;
            }}
            playsInline
            muted={slot === activeSlot ? muted : true}
            preload="auto"
            controls={slot === activeSlot && nativeFull}
            className={slot === activeSlot ? undefined : 'video-standby'}
            aria-hidden={slot !== activeSlot || undefined}
            aria-label={slot === activeSlot ? 'Recorded camera footage' : undefined}
            aria-describedby="video-gesture-help"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onLoadedMetadata={event => {
              const v = event.currentTarget;
              if (slot !== activeSlotRef.current) {
                v.currentTime = Math.min(Number(v.dataset.prepareOffset ?? 0), Math.max(0, v.duration - 0.01));
                return;
              }
              v.playbackRate = mediaRate;
              setDuration(Number.isFinite(v.duration) ? v.duration : (segment?.duration_s ?? 0));
              if (Number.isFinite(v.duration)) {
                const offset = Math.min(Math.max(0, selected.current?.offset ?? 0), Math.max(0, v.duration - 0.001));
                if (steps.pending()) steps.present(v, offset);
                v.currentTime = offset;
              }
            }}
            onLoadedData={() => {
              if (slot !== activeSlotRef.current) return;
              setReady(true);
              setHoldingFrame(false);
            }}
            onSeeking={() => {
              if (slot !== activeSlotRef.current || trickSeek.current) return;
              setSeeking(true);
            }}
            onSeeked={() => {
              if (slot !== activeSlotRef.current) return;
              const v = video.current!;
              setSeeking(false);
              setBuffering(false);
              if (v.readyState >= 2) {
                setReady(true);
                setHoldingFrame(false);
              }
              setTime(v.currentTime);
              if (segment) p.onProgress(segment.start, v.currentTime, true);
            }}
            onCanPlay={() => {
              if (slot !== activeSlotRef.current) return;
              setReady(true);
              setHoldingFrame(false);
              setBuffering(false);
            }}
            onTimeUpdate={() => {
              if (slot !== activeSlotRef.current) return;
              const v = video.current!;
              const current = selected.current;
              if (!current || v.readyState < 1 || clipOf(v) !== videoUrl(p.cam, current.segment) || !v.currentSrc)
                return;
              checkBoundary();
              setTime(v.currentTime);
              p.onProgress(current.segment.start, v.currentTime);
            }}
            onPlay={() => {
              if (slot !== activeSlotRef.current) return;
              if (!steps.pending()) setPrepareDirection(1);
              setPaused(false);
            }}
            onPause={() => {
              if (slot !== activeSlotRef.current) return;
              setPaused(true);
            }}
            onWaiting={() => {
              if (slot !== activeSlotRef.current || trickSeek.current) return;
              setBuffering(true);
            }}
            onPlaying={() => {
              if (slot !== activeSlotRef.current) return;
              setBuffering(false);
              setSeeking(false);
              setHoldingFrame(false);
              setReady(true);
            }}
            onVolumeChange={() => {
              if (slot !== activeSlotRef.current) return;
              setMuted(video.current!.muted);
            }}
            onEnded={() => {
              if (slot !== activeSlotRef.current) return;
              if (loop.enabled && loop.from !== null && loop.to !== null) {
                playLoop(loop.from, loop.to);
                return;
              }
              const next = p.segments[p.segments.findIndex(s => s.start === segment?.start) + 1];
              if (continuous && p.next && (!p.range || (next && Date.parse(next.start) < p.range.to))) p.onStep(1);
            }}
            onError={() => {
              if (slot !== activeSlotRef.current) return;
              steps.cancel();
              if (!selected.current) return;
              setBuffering(false);
              const unreachable = 'The recording could not be loaded. Check your connection and select it to retry.';
              const clip = clipOf(video.current);
              if (video.current?.error?.code === 2 || !clip) return setError(unreachable);
              // A failed download (a missing file, the footage store offline, a lapsed sign-in) is reported as an
              // unsupported source too, so read one byte to tell it from a recording the browser cannot decode.
              void fetch(clip, { headers: { Range: 'bytes=0-0' } })
                .then(r => r.ok && (r.headers.get('Content-Type') ?? '').startsWith('video/'))
                .catch(() => false)
                .then(playable => {
                  if (clipOf(video.current) !== clip) return;
                  setError(
                    playable
                      ? 'This browser cannot decode this HEVC recording. Download the original to play it locally.'
                      : unreachable,
                  );
                });
            }}
          />
        ))}
        <canvas
          ref={heldFrame}
          className="video-held-frame"
          hidden={!holdingFrame}
          aria-hidden="true"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
        {ready && !error && !!p.boxes?.length && (
          <div
            className="video-marks"
            aria-hidden="true"
            style={{
              left: (viewport.geometry.width - viewport.geometry.imageWidth) / 2,
              top: (viewport.geometry.height - viewport.geometry.imageHeight) / 2,
              width: viewport.geometry.imageWidth,
              height: viewport.geometry.imageHeight,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              ['--zoom' as string]: zoom,
            }}
          >
            {p.boxes.map((box, index) => (
              <span
                key={index}
                style={{
                  left: `${box[0] * 100}%`,
                  top: `${box[1] * 100}%`,
                  width: `${(box[2] - box[0]) * 100}%`,
                  height: `${(box[3] - box[1]) * 100}%`,
                }}
              />
            ))}
          </div>
        )}
        <span className="sr-only" id="video-gesture-help">
          Click or tap the video to play or pause. When zoomed in, drag to pan. Use I and O to mark a replay section.
        </span>
        <div className="viewer-top">
          <div className="viewer-actions">
            {p.onSave && (
              <ToolButton
                label={p.saved ? 'Remove saved recording' : 'Save recording'}
                aria-pressed={p.saved}
                disabled={!segment}
                onClick={p.onSave}
              >
                <Bookmark fill={p.saved ? 'currentColor' : 'none'} />
              </ToolButton>
            )}
            {segment && (
              <ToolButton label="Download original" asChild>
                <a href={downloadUrl(p.cam, segment)}>
                  <Download />
                </a>
              </ToolButton>
            )}
            {moreMenu}
            <ToolButton
              label={p.expanded ? 'Show side panel' : 'Hide side panel'}
              onClick={p.onExpand}
              aria-pressed={p.expanded}
            >
              <PanelRight />
            </ToolButton>
          </div>
        </div>
        {((!ready && !holdingFrame) || error) && (
          <div className="viewer-empty" role="status">
            {p.loading || (segment && !error) ? (
              <>
                <BrandIndicator size="player" />
                <h2>Loading recording</h2>
              </>
            ) : (
              <>
                <h2>
                  {error
                    ? 'Preview unavailable'
                    : p.loadFailed
                      ? 'Could not load this day'
                      : 'No recordings on this day'}
                </h2>
                <p>
                  {error ||
                    (p.loadFailed
                      ? 'Refresh to reconnect to your archive.'
                      : 'Choose another date, or open the latest recording.')}
                </p>
              </>
            )}
          </div>
        )}
        {ready && !error && paused && zoom === 1 && (
          <button className="center-play" onClick={toggle} aria-label="Play recording">
            <Play fill="currentColor" />
          </button>
        )}
        {waiting && showWait && (
          <div className="playback-wait" role="status">
            <BrandIndicator />
            <span>{holdingFrame ? `Loading ${clock}` : seeking ? 'Seeking…' : 'Buffering…'}</span>
          </div>
        )}

        <div className="video-zoom">
          <ToolButton label="Zoom out of video" onClick={() => zoomBy(-0.25)} disabled={zoom <= 1}>
            <Minus />
          </ToolButton>
          <DropdownMenu onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="zoom-value"
                aria-label={`Video zoom, ${Math.round(zoom * 100)} percent`}
              >
                <ZoomIn />
                <span>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="menu-content">
              <DropdownMenuRadioGroup value={String(zoom)} onValueChange={value => viewport.zoomTo(Number(value))}>
                {[1, 1.5, 2, 3, 4, 8].map(value => (
                  <DropdownMenuRadioItem key={value} value={String(value)}>
                    {value === 1 ? 'Fit to player' : `${value * 100}%`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton label="Zoom into video" disabled={zoom >= 8 || !ready} onClick={() => zoomBy(0.25)}>
            <Plus />
          </ToolButton>
          {zoom > 1 && (
            <ToolButton label="Reset video zoom" onClick={resetZoom}>
              <RotateCcw />
            </ToolButton>
          )}
        </div>
        {zoom > 1 && ready && !error && (
          <VideoNavigator
            video={video}
            time={time}
            geometry={viewport.geometry}
            transform={{ zoom, pan }}
            onCenter={viewport.centerAt}
            onPan={panBy}
          />
        )}
        {viewNotice && (
          <div className="video-notice" role="status">
            {viewNotice}
          </div>
        )}
      </div>
      <div
        ref={dock}
        className="player-dock"
        hidden={controls.minimized}
        style={controls.positionStyle}
        data-dragging={controls.dragging || undefined}
      >
        {!controls.minimized && (
          <>
            {floating && (
              <>
                <button
                  type="button"
                  className="dock-drag-handle"
                  aria-label="Move playback controls. Arrow keys move; Home resets position."
                  title="Drag to move controls"
                  {...controls.handleProps}
                >
                  <GripHorizontal />
                </button>
                <button
                  type="button"
                  className="dock-minimize"
                  aria-label="Minimize playback controls"
                  title="Minimize controls"
                  onClick={() => changeControlsMode('minimized')}
                >
                  <ChevronDown />
                </button>
              </>
            )}
            <div className="transport-row">
              <div className="transport-primary">
                <SeekButton seconds={-skipSeconds} onClick={() => seekBy(-skipSeconds)} disabled={!segment} />
                <ToolButton
                  label={paused ? 'Play recording' : 'Pause recording'}
                  className="play-button"
                  onClick={toggle}
                  disabled={!segment}
                >
                  {paused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
                </ToolButton>
                <SeekButton seconds={skipSeconds} onClick={() => seekBy(skipSeconds)} disabled={!segment} />
              </div>
              <div className="playback-clock" aria-label="Playback time">
                <strong>{segment ? clock : '—:—:—'}</strong>
                <span>
                  {paused || loop.enabled ? clipTime(time) : mediaTime(time)} / {mediaTime(duration)}
                </span>
              </div>
              <div className="transport-options">
                <ToolButton
                  className="replay-tools-button"
                  label="Replay and skip settings"
                  aria-pressed={loop.enabled}
                  onClick={openReview}
                >
                  <Repeat2 />
                </ToolButton>
                {immersive && p.onBrowse && (
                  <Button
                    variant="ghost"
                    className="fullscreen-browse-button"
                    aria-label="Browse footage"
                    onClick={p.onBrowse}
                  >
                    <Grid2X2 />
                    <span>Browse</span>
                  </Button>
                )}
                <div className="mobile-player-actions">
                  {landscape ? (
                    <LandscapePlayerOptions
                      open={optionsOpen}
                      onOpenChange={setOptionsOpen}
                      ready={ready}
                      previous={p.previous}
                      next={p.next}
                      onStep={p.onStep}
                      speed={speed}
                      onSpeed={setSpeed}
                      continuous={continuous}
                      onContinuous={setContinuous}
                      muted={muted}
                      onMute={mute}
                      zoom={zoom}
                      onZoom={zoomBy}
                      onFit={resetZoom}
                      onFill={fillVideo}
                      mode={controls.mode}
                      onMode={changeControlsMode}
                      full={full}
                      onFullscreen={() => void fullscreen()}
                      saved={p.saved}
                      download={segment ? downloadUrl(p.cam, segment) : undefined}
                      onSave={p.onSave}
                      onCopy={p.onCopy}
                      onDetails={p.onDetails}
                      onReplay={openReview}
                      onFindTime={p.onFindTime}
                    />
                  ) : (
                    moreMenu
                  )}
                </div>
                <ToolButton className="desktop-audio" label={muted ? 'Unmute audio' : 'Mute audio'} onClick={mute}>
                  {muted ? <VolumeX /> : <Volume2 />}
                </ToolButton>
                <DropdownMenu onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="speed-button" aria-label={`Playback speed, ${speed} times`}>
                      {speed}×
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end" className="menu-content">
                    <DropdownMenuRadioGroup value={speed} onValueChange={setSpeed}>
                      {PLAYBACK_SPEEDS.map(s => (
                        <DropdownMenuRadioItem key={s} value={s}>
                          {s}×{s === '1' ? ' · Normal' : ''}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ToolButton
                  className="fullscreen-button"
                  label={full ? 'Exit full screen' : 'Full screen'}
                  onClick={() => void fullscreen()}
                  disabled={!segment}
                >
                  {full ? <Minimize /> : <Maximize />}
                </ToolButton>
              </div>
            </div>
            <RecordingScrubber
              marks={p.marks}
              onInteractionChange={setMenuOpen}
              day={p.day}
              zone={p.zone}
              segments={p.segments}
              selected={segment ?? null}
              time={absoluteTime}
              range={p.range}
              onClearRange={() => p.onRange(null)}
              loop={loopRange}
              onExitLoop={() => setLoop({ ...loop, enabled: false })}
              onSeek={date => seekTo(date)}
            />
          </>
        )}
      </div>
      <PlaybackReview
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        anchor={dock}
        skip={skipSeconds}
        onSkip={setSkip}
        loop={loop}
        time={time}
        min={loopMin}
        max={loopMax}
        ready={ready}
        onLast={loopLast}
        onMark={markLoop}
        onBounds={(from, to) => setLoop({ from, to, enabled: false })}
        onToggle={toggleLoop}
        onClear={() => setLoop(EMPTY_LOOP)}
      />
      {immersive && controls.minimized && <div className="fullscreen-controls-shelf">{minimizedControls}</div>}
      {controls.minimized && !immersive && p.controlsHost && createPortal(minimizedControls, p.controlsHost)}
    </section>
  );
});
