import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  anchoredZoom,
  boundPan,
  videoGeometry,
  type Point,
  type VideoGeometry,
  type VideoTransform,
} from '../lib/video-viewport';

type SafariGesture = Event & { scale: number; clientX?: number; clientY?: number };
export function useVideoViewport(
  video: RefObject<HTMLVideoElement | null>,
  stage: RefObject<HTMLDivElement | null>,
  onTap: () => void,
  mediaIdentity = 0,
) {
  const initial = { zoom: 1, pan: { x: 0, y: 0 } };
  const [transform, setTransform] = useState<VideoTransform>(initial);
  const current = useRef<VideoTransform>(initial);
  const [geometry, setGeometry] = useState<VideoGeometry>(videoGeometry(1, 1, 16, 9));
  const dimensions = useRef(geometry);
  const tap = useRef(onTap);
  tap.current = onTap;
  function apply(next: VideoTransform) {
    current.current = next;
    setTransform(next);
  }
  function zoomTo(zoom: number, anchor = { x: 0, y: 0 }) {
    apply(anchoredZoom(current.current, zoom, anchor, dimensions.current));
  }
  function panBy(x: number, y: number) {
    apply({
      ...current.current,
      pan: boundPan(
        { x: current.current.pan.x + x, y: current.current.pan.y + y },
        current.current.zoom,
        dimensions.current,
      ),
    });
  }
  function centerAt(x: number, y: number) {
    apply({
      ...current.current,
      pan: boundPan(
        {
          x: (0.5 - x) * dimensions.current.imageWidth * current.current.zoom,
          y: (0.5 - y) * dimensions.current.imageHeight * current.current.zoom,
        },
        current.current.zoom,
        dimensions.current,
      ),
    });
  }
  function reset() {
    apply({ zoom: 1, pan: { x: 0, y: 0 } });
  }
  useEffect(() => {
    const element = stage.current!;
    const media = video.current!;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const next = videoGeometry(rect.width, rect.height, media.videoWidth, media.videoHeight);
      const old = dimensions.current;
      dimensions.current = next;
      setGeometry(next);
      apply({
        ...current.current,
        pan: boundPan(
          {
            x: (current.current.pan.x * next.imageWidth) / (old.imageWidth || 1),
            y: (current.current.pan.y * next.imageHeight) / (old.imageHeight || 1),
          },
          current.current.zoom,
          next,
        ),
      });
    };
    const local = (x: number, y: number): Point => {
      const rect = element.getBoundingClientRect();
      return { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 };
    };
    const pointers = new Map<number, Point>();
    let drag: { point: Point; pan: Point } | null = null;
    let pinch: { distance: number; anchor: Point; transform: VideoTransform } | null = null;
    let native: { transform: VideoTransform; anchor: Point } | null = null;
    let moved = false;
    const pair = () => {
      const [a, b] = [...pointers.values()];
      return {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        center: local((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      media.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        drag = { point: { x: event.clientX, y: event.clientY }, pan: { ...current.current.pan } };
        moved = false;
      }
      if (pointers.size === 2) {
        const p = pair();
        pinch = {
          distance: p.distance,
          anchor: p.center,
          transform: { zoom: current.current.zoom, pan: { ...current.current.pan } },
        };
        moved = true;
      }
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinch) {
        const p = pair();
        const next = anchoredZoom(
          pinch.transform,
          (pinch.transform.zoom * p.distance) / pinch.distance,
          pinch.anchor,
          dimensions.current,
        );
        next.pan = boundPan(
          { x: next.pan.x + p.center.x - pinch.anchor.x, y: next.pan.y + p.center.y - pinch.anchor.y },
          next.zoom,
          dimensions.current,
        );
        apply(next);
        return;
      }
      if (drag) {
        const dx = event.clientX - drag.point.x;
        const dy = event.clientY - drag.point.y;
        if (Math.hypot(dx, dy) > 6) moved = true;
        if (moved && current.current.zoom > 1)
          apply({
            ...current.current,
            pan: boundPan({ x: drag.pan.x + dx, y: drag.pan.y + dy }, current.current.zoom, dimensions.current),
          });
      }
    };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      if (
        event.type !== 'pointerup' ||
        (drag && Math.hypot(event.clientX - drag.point.x, event.clientY - drag.point.y) > 6)
      )
        moved = true;
      pointers.delete(event.pointerId);
      pinch = null;
      if (pointers.size) {
        drag = { point: [...pointers.values()][0], pan: { ...current.current.pan } };
        return;
      }
      drag = null;
      if (!moved && event.type === 'pointerup') tap.current();
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('button, [role="menu"], .video-navigator')) return;
      if (event.ctrlKey) {
        event.preventDefault();
        if (!native && pointers.size < 2)
          zoomTo(current.current.zoom * Math.exp(-event.deltaY * 0.01), local(event.clientX, event.clientY));
      } else if (current.current.zoom > 1) {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dimensions.current.height : 1;
        panBy(-event.deltaX * unit, -event.deltaY * unit);
      }
    };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      if (pointers.size >= 2) return;
      const e = event as SafariGesture;
      native = {
        transform: { zoom: current.current.zoom, pan: { ...current.current.pan } },
        anchor: e.clientX !== undefined && e.clientY !== undefined ? local(e.clientX, e.clientY) : { x: 0, y: 0 },
      };
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      if (native && pointers.size < 2)
        apply(
          anchoredZoom(
            native.transform,
            native.transform.zoom * (event as SafariGesture).scale,
            native.anchor,
            dimensions.current,
          ),
        );
    };
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      native = null;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    media.addEventListener('loadedmetadata', update);
    media.addEventListener('pointerdown', down);
    media.addEventListener('pointermove', move);
    media.addEventListener('pointerup', up);
    media.addEventListener('pointercancel', up);
    media.addEventListener('lostpointercapture', up);
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', gestureStart, { passive: false });
    element.addEventListener('gesturechange', gestureChange, { passive: false });
    element.addEventListener('gestureend', gestureEnd, { passive: false });
    return () => {
      observer.disconnect();
      media.removeEventListener('loadedmetadata', update);
      media.removeEventListener('pointerdown', down);
      media.removeEventListener('pointermove', move);
      media.removeEventListener('pointerup', up);
      media.removeEventListener('pointercancel', up);
      media.removeEventListener('lostpointercapture', up);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', gestureStart);
      element.removeEventListener('gesturechange', gestureChange);
      element.removeEventListener('gestureend', gestureEnd);
    };
  }, [video, stage, mediaIdentity]);
  return {
    ...transform,
    geometry,
    zoomTo,
    zoomBy: (amount: number) => zoomTo(current.current.zoom + amount),
    panBy,
    centerAt,
    reset,
  };
}
