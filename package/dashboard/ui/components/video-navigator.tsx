import { useLayoutEffect, useRef, type RefObject } from 'react';
import { visibleFrame, type VideoGeometry, type VideoTransform } from '../lib/video-viewport';

export function VideoNavigator({
  video,
  time,
  geometry,
  transform,
  onCenter,
  onPan,
}: {
  video: RefObject<HTMLVideoElement | null>;
  time: number;
  geometry: VideoGeometry;
  transform: VideoTransform;
  onCenter: (x: number, y: number) => void;
  onPan: (x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = visibleFrame(transform, geometry);
  useLayoutEffect(() => {
    const media = video.current;
    const target = canvas.current;
    if (!media || !target || media.readyState < 2) return;
    const width = 320;
    const height = Math.round((width * (media.videoHeight || 9)) / (media.videoWidth || 16));
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
    }
    target.getContext('2d')?.drawImage(media, 0, 0, width, height);
  }, [video, time, geometry]);
  const move = (element: HTMLButtonElement, x: number, y: number) => {
    const rect = element.getBoundingClientRect();
    onCenter(
      Math.max(0, Math.min(1, (x - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (y - rect.top) / rect.height)),
    );
  };
  return (
    <button
      className="video-navigator"
      aria-label="Video overview. Drag the view box to pan; use arrow keys to move."
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.currentTarget, event.clientX, event.clientY);
      }}
      onPointerMove={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          move(event.currentTarget, event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          onPan(
            event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0,
            event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0,
          );
        }
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <span
        className="navigator-viewbox"
        style={{
          left: `${frame.x * 100}%`,
          top: `${frame.y * 100}%`,
          width: `${frame.width * 100}%`,
          height: `${frame.height * 100}%`,
        }}
      />
    </button>
  );
}
