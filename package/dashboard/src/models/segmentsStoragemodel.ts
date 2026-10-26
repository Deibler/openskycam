import type { SegmentRow } from './catalogStoragemodel';
export interface SegmentQuery {
  camera: string | null;
  from: string | null;
  to: string | null;
}
export interface SegmentList {
  cam: string;
  from: string;
  to: string;
  segments: SegmentRow[];
}
