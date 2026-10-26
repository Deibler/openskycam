import type { WorkshopItem, WorkshopAnnotation, WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';

export interface ReviewFrameProps {
  item: WorkshopItem;
  imageUrl?: string;
  temporary?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  onInspect: () => void;
}
export interface ImageInspectorProps {
  imageUrl?: string;
  item: WorkshopItem;
  onClose: () => void;
}
export interface ImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImageGeometry {
  width: number;
  height: number;
  annotations: WorkshopAnnotation[];
}
export interface Size {
  width: number;
  height: number;
}
/** A rectangle in screen px, from the top left of the element it is measured in. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Places a frame on screen: screen px = frame px × scale + (x, y). */
export interface Camera {
  scale: number;
  x: number;
  y: number;
}
/** A box edge or corner by compass point, or the whole box. */
export type BoxHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'move';
export type ReviewDecision = WorkshopItem['review'];
/** What a finished feed offers next: another run of its workflow, or another workflow, with photos to review. */
export interface NextReview {
  kind: 'run' | 'workflow';
  id: string;
  name: string;
  pending: number;
}
/** How this browser's reviewer opens: a sighting on its video or its surest photo, and the feed or the batch grid. */
export interface ReviewerPreferences {
  open: 'video' | 'photo';
  view: 'feed' | 'grid';
}
/** One photo's new review, with the labels to save alongside it when they change. */
export type ReviewChange = [item: WorkshopRunImage, review: ReviewDecision, labels?: WorkshopAnnotation[]];
