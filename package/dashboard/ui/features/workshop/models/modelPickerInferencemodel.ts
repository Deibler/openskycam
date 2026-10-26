import type { ModelCatalogEntry, ModelVersion } from '../../../../src/models/modelInferencemodel';

export type PickerTask = 'all' | 'object-detection' | 'image-classification';
export type ModelPickerView =
  | { kind: 'browse' }
  | { kind: 'classes' }
  | { kind: 'versions'; family: string; task: ModelVersion['task'] }
  | { kind: 'details'; modelKey: string };
export interface ModelPickerHistoryEntry {
  view: ModelPickerView;
  scrollTop: number;
  focusKey?: string;
}
export interface ModelPickerFilters {
  query: string;
  task: PickerTask;
  classes: string[];
}
export interface ModelClassFacet {
  key: string;
  label: string;
  count: number;
}
export interface ModelPickerGroup {
  family: string;
  name: string;
  task: ModelVersion['task'];
  versions: ModelCatalogEntry[];
}
