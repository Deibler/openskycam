import type { Totals, DaySummary } from './catalogStoragemodel';
import type { Viewer } from './applicationSharedmodel';
export interface StorageHealth {
  healthy: boolean;
  newest_start: string | null;
  newest_uploaded_at: string | null;
  age_seconds: number | null;
}
export interface StorageProjection {
  bytes_per_day: number | null;
  steady_state_bytes: number | null;
}
export interface StorageOverview {
  viewer: Viewer;
  cameras: string[];
  cam: string;
  generated_at: string;
  health: StorageHealth;
  last_24h: Totals;
  retained: Totals;
  days: DaySummary[];
  projection: StorageProjection;
}
