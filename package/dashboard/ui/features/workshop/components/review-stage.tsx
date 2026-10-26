import { useEffect, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import type { WorkshopAnnotation, WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { Camera, ScreenRect, Size } from '../models/reviewInferencemodel';
import { useStageZoom } from '../hooks/use-stage-zoom';
import { useViewSize } from '../hooks/use-view-size';
import { cropStyle, focusCamera, layerStyle, screenBox } from '../utils/reviewCameraInferenceUtil';
import { thumbnailUrl } from '../utils/browserInferenceUtil';
import { thumbnailCrop } from '../../../../src/utils/thumbnailInferenceUtil';
import { imageGeometry } from '../utils/reviewGeometryInferenceUtil';
import { classColor, labelsOf, motionCaption, overlapped, topBox, tracksOf } from '../utils/sightingInferenceUtil';
import type { WorkshopTrack } from '../../../../src/models/workshopInferencemodel';

/** A box in screen px, grown around its center to at least `min` so a few-pixel object stays visible. */
export function ringStyle(frame: Size, camera: Camera, box: number[], min = 14): CSSProperties {
  const s = screenBox(frame, camera, box),
    width = Math.max(min, s.width),
    height = Math.max(min, s.height);
  return { left: s.left - (width - s.width) / 2, top: s.top - (height - s.height) / 2, width, height };
}

/** Label outlines drawn in screen space, so they stay crisp at any zoom and follow camera moves. Boxes a Yes drops, keeping `prefer`'s, are dashed. */
export function Outlines({
  labels,
  frame,
  camera,
  prefer,
  tracks,
}: {
  labels: WorkshopAnnotation[];
  frame: Size;
  camera: Camera;
  prefer?: string;
  tracks?: Map<string, WorkshopTrack>;
}) {
  const dropped = overlapped(labels, prefer);
  return (
    <>
      {labels.map(
        (label, index) =>
          label.box && (
            <i
              key={index}
              className="wk-outline"
              aria-hidden="true"
              data-dropped={dropped.includes(index) || undefined}
              style={{ ...ringStyle(frame, camera, label.box), '--box': classColor(label.class_id) } as CSSProperties}
            >
              <span>
                {label.class_name}
                {label.edited ? '' : ` ${Math.round(label.confidence * 100)}%`}
                {label.track_id && tracks?.has(label.track_id) && (
                  <small>{motionCaption(tracks.get(label.track_id)!, frame.height)}</small>
                )}
              </span>
            </i>
          ),
      )}
    </>
  );
}

/**
 * Where each box's object went in its recording: a line through its detections and, when every frame was read,
 * a dot per frame it was seen in near this photo. Drawn in screen space like the outlines.
 */
export function Trajectories({
  labels,
  tracks,
  frame,
  camera,
}: {
  labels: WorkshopAnnotation[];
  tracks: Map<string, WorkshopTrack>;
  frame: Size;
  camera: Camera;
}) {
  const at = (x: number, y: number) => [
    camera.x + x * frame.width * camera.scale,
    camera.y + y * frame.height * camera.scale,
  ];
  const shown = labels.filter(label => label.track_id && tracks.get(label.track_id)?.motion !== 'stationary');
  if (!shown.length) return null;
  return (
    <svg className="wk-trajectories" aria-hidden="true">
      {shown.map((label, index) => {
        const track = tracks.get(label.track_id!)!;
        return (
          <g key={index} style={{ '--box': classColor(label.class_id) } as CSSProperties}>
            {track.path.length > 1 && <polyline points={track.path.map(p => at(p[1], p[2]).join(',')).join(' ')} />}
            {track.scan?.samples
              .filter(s => s[1] != null)
              .map((s, i) => {
                const [cx, cy] = at(s[1]!, s[2]!);
                return <circle key={i} r={2} cx={cx} cy={cy} />;
              })}
          </g>
        );
      })}
    </svg>
  );
}

/** The object's thumbnail, which the grid has usually loaded already, in its place under the original while that loads. */
export function ThumbnailLayer({ item, frame, camera }: { item: WorkshopRunImage; frame: Size; camera: Camera }) {
  const box = topBox(item);
  return box ? (
    <img
      className="wk-stage-layer"
      src={thumbnailUrl(item, true, true)}
      alt=""
      draggable={false}
      style={cropStyle(thumbnailCrop(frame.width, frame.height, box), camera)}
    />
  ) : null;
}

/**
 * The whole frame, small, while a stage is zoomed past its framing: the box marks what is on screen,
 * and dragging on the map moves it there.
 */
export function StageMap({
  src,
  frame,
  view,
  camera,
  onLook,
  onReset,
}: {
  src: string;
  frame: Size;
  view: Size;
  camera: Camera;
  onLook: (camera: Camera) => void;
  onReset: () => void;
}) {
  const width = frame.width * camera.scale,
    height = frame.height * camera.scale,
    clamp = (n: number) => Math.max(0, Math.min(1, n));
  const left = clamp(-camera.x / width),
    top = clamp(-camera.y / height),
    right = clamp((view.width - camera.x) / width),
    bottom = clamp((view.height - camera.y) / height);
  function center(e: ReactPointerEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    onLook({
      scale: camera.scale,
      x: view.width / 2 - ((e.clientX - r.left) / r.width) * width,
      y: view.height / 2 - ((e.clientY - r.top) / r.height) * height,
    });
  }
  return (
    <div className="wk-map">
      <button
        type="button"
        className="wk-map-frame"
        aria-label="Whole frame. Drag to look around."
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          center(e);
        }}
        onPointerMove={e => {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) center(e);
        }}
      >
        <img src={src} alt="" draggable={false} />
        <i
          style={{
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${(right - left) * 100}%`,
            height: `${(bottom - top) * 100}%`,
          }}
        />
      </button>
      <button
        type="button"
        className="wk-glass wk-glass-button wk-map-reset"
        aria-label="Back to the framed view"
        onClick={e => {
          e.stopPropagation();
          onReset();
        }}
      >
        <RotateCcw />
      </button>
    </div>
  );
}

/**
 * One photo, zoomed to its most confident object or fitted whole; a pinch looks closer. `onBox` hears
 * where that object and its label are, in stage px, as the camera moves.
 */
export function FrameStage({
  item,
  zoomed,
  active,
  prefer,
  onBox,
}: {
  item: WorkshopRunImage;
  zoomed: boolean;
  active: boolean;
  prefer?: string;
  onBox?: (rect: ScreenRect | null) => void;
}) {
  const [ref, view] = useViewSize<HTMLDivElement>();
  const { width, height } = imageGeometry(item),
    frame = { width, height };
  const look = useStageZoom(
    ref,
    view,
    frame,
    focusCamera(view, frame, zoomed ? topBox(item) : undefined),
    `${active} ${zoomed}`,
  );
  const box = topBox(item),
    spot = box && view.width ? screenBox(frame, look.camera, box) : null,
    tracks = tracksOf(item);
  useEffect(() => {
    // The label sits above the box.
    onBox?.(
      spot && { left: spot.left, top: spot.top - 24, right: spot.left + spot.width, bottom: spot.top + spot.height },
    );
  }, [onBox, spot?.left, spot?.top, spot?.width, spot?.height]);
  return (
    <div className="wk-stage" ref={ref} data-looking={look.zoomed || undefined}>
      {view.width > 0 && (
        <>
          <ThumbnailLayer item={item} frame={frame} camera={look.camera} />
          <img
            className="wk-stage-layer"
            src={item.image_url}
            alt={`Camera frame at ${new Date(item.captured_at).toLocaleTimeString()}`}
            draggable={false}
            style={layerStyle(frame, look.camera)}
          />
          <Trajectories labels={labelsOf(item)} tracks={tracks} frame={frame} camera={look.camera} />
          <Outlines labels={labelsOf(item)} frame={frame} camera={look.camera} prefer={prefer} tracks={tracks} />
          {look.zoomed && (
            <StageMap
              src={item.image_url}
              frame={frame}
              view={view}
              camera={look.camera}
              onLook={look.setLook}
              onReset={look.reset}
            />
          )}
        </>
      )}
    </div>
  );
}
