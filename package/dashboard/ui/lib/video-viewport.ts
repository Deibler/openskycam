export type Point = { x: number; y: number };
export type VideoGeometry = { width: number; height: number; imageWidth: number; imageHeight: number };
export type VideoTransform = { zoom: number; pan: Point };
export function videoGeometry(width: number, height: number, sourceWidth: number, sourceHeight: number): VideoGeometry {
  const ratio = Math.min(width / (sourceWidth || width || 1), height / (sourceHeight || height || 1));
  return { width, height, imageWidth: (sourceWidth || width) * ratio, imageHeight: (sourceHeight || height) * ratio };
}
export function boundPan(pan: Point, zoom: number, geometry: VideoGeometry): Point {
  const x = Math.max(0, (geometry.imageWidth * zoom - geometry.width) / 2);
  const y = Math.max(0, (geometry.imageHeight * zoom - geometry.height) / 2);
  return { x: Math.max(-x, Math.min(x, pan.x)), y: Math.max(-y, Math.min(y, pan.y)) };
}
// Keep the image point underneath the gesture center stationary as scale changes.
export function anchoredZoom(
  current: VideoTransform,
  requested: number,
  anchor: Point,
  geometry: VideoGeometry,
): VideoTransform {
  const zoom = Math.max(1, Math.min(8, requested));
  const ratio = zoom / current.zoom;
  return {
    zoom,
    pan: boundPan(
      { x: anchor.x - (anchor.x - current.pan.x) * ratio, y: anchor.y - (anchor.y - current.pan.y) * ratio },
      zoom,
      geometry,
    ),
  };
}
export function visibleFrame(transform: VideoTransform, geometry: VideoGeometry) {
  const width = Math.max(1, geometry.imageWidth * transform.zoom);
  const height = Math.max(1, geometry.imageHeight * transform.zoom);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const left = clamp(0.5 + (-geometry.width / 2 - transform.pan.x) / width);
  const top = clamp(0.5 + (-geometry.height / 2 - transform.pan.y) / height);
  const right = clamp(0.5 + (geometry.width / 2 - transform.pan.x) / width);
  const bottom = clamp(0.5 + (geometry.height / 2 - transform.pan.y) / height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
