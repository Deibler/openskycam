import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Play } from 'lucide-react';
import { cachedClip, clipPart, loadingClip } from '../../../lib/clip-cache';
import { videoUrl } from '../../../lib/archive/api.js';
import type { Sighting, SightingClip as Clip } from '../models/sightingInferencemodel';
import { useStageZoom } from '../hooks/use-stage-zoom';
import { useViewSize } from '../hooks/use-view-size';
import { focusCamera, layerStyle } from '../utils/reviewCameraInferenceUtil';
import { imageGeometry, unionBox } from '../utils/reviewGeometryInferenceUtil';
import { boxAt, topBox, topLabel } from '../utils/sightingInferenceUtil';
import { ringStyle, StageMap, ThumbnailLayer } from './review-stage';

export const clipUrl = (sighting: Sighting, clip: Clip | null) =>
  clip ? videoUrl(sighting.frames[0].cam, clip.recording) : null;
/** The cache key for just the sighting's seconds of its recording, which the feed downloads ahead. */
export const clipKey = (sighting: Sighting, clip: Clip) => clipPart(clipUrl(sighting, clip)!, clip.from, clip.to);

/**
 * The seconds of video around a sighting, looping, framed on everywhere the object went. Its best
 * photo shows at once; only the active card plays video, with a ring following the object between frames.
 */
export function SightingClip({
  sighting,
  clip,
  active,
  zoomed,
  speed,
  player,
}: {
  sighting: Sighting;
  clip: Clip;
  active: boolean;
  zoomed: boolean;
  speed: number;
  player: RefObject<HTMLVideoElement | null>;
}) {
  const [ref, view] = useViewSize<HTMLDivElement>();
  const poster = sighting.frames.reduce((best, frame) =>
    (topLabel(frame)?.confidence ?? 0) > (topLabel(best)?.confidence ?? 0) ? frame : best,
  );
  const geometry = imageGeometry(poster),
    frame = { width: clip.recording.width ?? geometry.width, height: clip.recording.height ?? geometry.height };
  // A lone frame keeps its photo's framing, so switching between photo and clip doesn't jump.
  const look = useStageZoom(
      ref,
      view,
      frame,
      focusCamera(
        view,
        frame,
        zoomed ? unionBox(sighting.frames.map(topBox)) : undefined,
        sighting.frames.length > 1 ? 2 : 4,
      ),
      `${active} ${zoomed}`,
    ),
    camera = look.camera;
  const [state, setState] = useState<'loading' | 'playing' | 'paused' | 'failed'>('loading');
  // The sighting's seconds from memory, waiting while they download; the recording streams only if
  // they can't be fetched. `shift` is the recording time at the copy's start.
  const key = clipKey(sighting, clip),
    cached = active ? cachedClip(key) : null,
    waiting = active && !cached && loadingClip(key);
  const { src, shift } = useMemo(
    () =>
      !active || waiting
        ? { src: undefined, shift: 0 }
        : cached
          ? { src: `${cached.url}#t=${clip.from - cached.offset}`, shift: cached.offset }
          : { src: `${clipUrl(sighting, clip)}#t=${clip.from}`, shift: 0 },
    [active, waiting, state === 'loading' && !!cached],
  );
  useEffect(() => {
    if (player.current) player.current.defaultPlaybackRate = player.current.playbackRate = speed;
  }, [speed, src]);
  useEffect(() => {
    if (!active) setState('loading');
  }, [active]);
  const ring = useRef<HTMLElement>(null),
    progress = useRef<HTMLElement>(null),
    placed = useRef({ frame, camera });
  placed.current = { frame, camera };
  const start = Date.parse(clip.recording.start),
    span = clip.to - clip.from;
  useEffect(() => {
    if (!active) return;
    let request = requestAnimationFrame(function tick() {
      const video = player.current;
      if (video && video.readyState > 0) {
        const time = video.currentTime + shift;
        if (time >= clip.to || time < clip.from - 0.25) video.currentTime = clip.from - shift;
        const box = boxAt(sighting.frames, start + (video.currentTime + shift) * 1000);
        if (ring.current) {
          ring.current.style.opacity = box ? '1' : '0';
          if (box)
            Object.assign(
              ring.current.style,
              Object.fromEntries(
                Object.entries(ringStyle(placed.current.frame, placed.current.camera, box, 22)).map(([k, v]) => [
                  k,
                  `${v}px`,
                ]),
              ),
            );
        }
        if (progress.current)
          progress.current.style.width = `${Math.max(0, Math.min(1, (video.currentTime + shift - clip.from) / span)) * 100}%`;
      }
      request = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(request);
  }, [active, clip, sighting.frames, player, start, span, shift]);
  function toggle() {
    const video = player.current;
    if (video) void (video.paused ? video.play().catch(() => {}) : video.pause());
  }
  return (
    <div
      className="wk-stage wk-clip"
      ref={ref}
      data-looking={look.zoomed || undefined}
      onClick={active ? toggle : undefined}
    >
      {view.width > 0 && (
        <>
          <ThumbnailLayer item={poster} frame={frame} camera={camera} />
          <img
            className="wk-stage-layer"
            src={poster.image_url}
            alt=""
            draggable={false}
            style={layerStyle(frame, camera)}
          />
          {active && (
            <video
              ref={player}
              className="wk-stage-layer"
              data-ready={state === 'playing' || state === 'paused' || undefined}
              src={src}
              muted
              autoPlay
              playsInline
              aria-label="Sighting video"
              style={layerStyle(frame, camera)}
              onLoadedMetadata={e => {
                e.currentTarget.defaultPlaybackRate = e.currentTarget.playbackRate = speed;
              }}
              onPlaying={() => setState('playing')}
              onPause={() => setState('paused')}
              onError={() => setState('failed')}
              onEnded={e => {
                e.currentTarget.currentTime = clip.from - shift;
                void e.currentTarget.play().catch(() => {});
              }}
            />
          )}
          {active && <i className="wk-ring" ref={ring} aria-hidden="true" />}
          {active && look.zoomed && (
            <StageMap
              src={poster.image_url}
              frame={frame}
              view={view}
              camera={camera}
              onLook={look.setLook}
              onReset={look.reset}
            />
          )}
        </>
      )}
      {active && state === 'paused' && (
        <span className="wk-clip-paused" aria-hidden="true">
          <Play />
        </span>
      )}
      {active && state === 'failed' && (
        <p className="wk-clip-failed" role="status">
          Video unavailable
        </p>
      )}
      {active && state !== 'failed' && (
        <div className="wk-clip-bar" aria-hidden="true">
          <i ref={progress} />
          {sighting.frames.map(f => (
            <b
              key={f.id}
              style={{ left: `${(((Date.parse(f.captured_at) - start) / 1000 - clip.from) / span) * 100}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
