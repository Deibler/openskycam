export interface BrowserFilters {
  q: string;
  run: string;
  camera: string;
  class: string;
  review: string;
  from: string;
  to: string;
  min_confidence: string;
  max_confidence: string;
  min_objects: string;
  max_objects: string;
  saved: string;
  sort: string;
}
export interface BrowserPreferences {
  filters: BrowserFilters;
  crop: boolean;
}
