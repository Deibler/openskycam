import { useEffect, useRef } from 'react';

/** Every tap is a comparison frame. Never replace an in-flight seek with the last tap. */
export function useFrameSteps(apply: (time: number) => void, resume: () => void) {
  const callbacks = useRef({ apply, resume });
  callbacks.current = { apply, resume };
  const queue = useRef<number[]>([]);
  const current = useRef<number | null>(null);
  const playing = useRef(false);
  const release = useRef<(() => void) | null>(null);

  function cancel() {
    release.current?.();
    release.current = null;
    current.current = null;
    queue.current = [];
    playing.current = false;
  }
  function next() {
    release.current?.();
    release.current = null;
    current.current = queue.current.shift() ?? null;
    if (current.current !== null) callbacks.current.apply(current.current);
    else if (playing.current) {
      playing.current = false;
      callbacks.current.resume();
    }
  }
  function push(time: number, play: boolean) {
    if (current.current === null) playing.current = play;
    queue.current.push(time);
    if (current.current === null) next();
  }
  function present(media: HTMLVideoElement, offset: number) {
    if (current.current === null) return;
    release.current?.();
    let stopped = false;
    let frame = 0;
    let paint = 0;
    let completing = false;
    const hasVideoFrames = typeof media.requestVideoFrameCallback === 'function';
    const complete = () => {
      if (stopped || completing) return;
      completing = true;
      // Allow the compositor to display this frame before another seek can replace it.
      paint = requestAnimationFrame(() => {
        paint = requestAnimationFrame(() => {
          if (!stopped) next();
        });
      });
    };
    const tick: VideoFrameRequestCallback = (_now, metadata) => {
      if (stopped) return;
      if (Math.abs(metadata.mediaTime - offset) < 0.09) {
        if (!media.seeking) complete();
      } else frame = media.requestVideoFrameCallback(tick);
    };
    const seeked = () => {
      // Paused decoders don't always deliver a new frame callback. A completed seek
      // with decoded data plus two paints also guarantees a visible comparison step.
      if (!media.seeking && media.readyState >= 2 && Math.abs(media.currentTime - offset) < 0.01) complete();
    };
    if (hasVideoFrames) frame = media.requestVideoFrameCallback(tick);
    media.addEventListener('seeked', seeked);
    media.addEventListener('loadeddata', seeked);
    media.addEventListener('canplay', seeked);
    release.current = () => {
      stopped = true;
      if (frame) media.cancelVideoFrameCallback(frame);
      cancelAnimationFrame(paint);
      media.removeEventListener('seeked', seeked);
      media.removeEventListener('loadeddata', seeked);
      media.removeEventListener('canplay', seeked);
    };
    // A prepared clip can already be showing precisely the requested frame.
    if (!media.seeking && media.readyState >= 2 && Math.abs(media.currentTime - offset) < 0.001) complete();
  }
  useEffect(() => cancel, []);
  return {
    push,
    present,
    cancel,
    pending: () => current.current !== null,
    target: () => current.current,
    tail: () => queue.current.at(-1) ?? current.current,
    accepts: (time: number) => current.current !== null && Math.abs(current.current - time) < 2,
  };
}
