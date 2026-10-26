export interface CameraStatus {
  cam: string;
  newest: string | null;
  age_seconds: number | null;
}
export interface StorageStatus {
  healthy: boolean;
  cameras: CameraStatus[];
}
export interface NewestSegment {
  object_key: string;
  uploaded_at: string;
}
