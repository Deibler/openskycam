import type { ModelVersion } from '../../src/models/modelInferencemodel';

export const modelKey = (model: ModelVersion) => `${model.family}/${model.version}`;
export const taskLabel = (task: ModelVersion['task']) =>
  ({
    'object-detection': 'Object detection',
    'image-classification': 'Image classification',
    'feature-classification': 'Feature classification',
    'image-encoder': 'Image encoder',
  })[task];
export const canDeploy = (model: ModelVersion) =>
  model.adapter === 'ultralytics' && model.artifacts.some(a => a.filename.endsWith('.pt'));
export function modelSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
export function inputSize(value: unknown): string {
  if (typeof value === 'number') return `${value} × ${value} px`;
  if (Array.isArray(value) && value.every(v => typeof v === 'number')) return `${value.join(' × ')} px`;
  return typeof value === 'string' ? value : 'Not recorded';
}
export function groupModels(models: ModelVersion[]) {
  const groups = new Map<string, ModelVersion[]>();
  for (const model of models) groups.set(model.family, [...(groups.get(model.family) ?? []), model]);
  return [...groups].map(([family, versions]) => ({ family, name: versions[0].name.split(' · ')[0], versions }));
}
export function matchesModel(model: ModelVersion, query: string) {
  return `${modelKey(model)} ${model.name} ${model.description} ${taskLabel(model.task)} ${model.classes.map(c => c.name).join(' ')}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
export function readableKey(key: string) {
  const labels: Record<string, string> = {
    'mAP50(B)': 'mAP @ 0.50',
    'mAP50-95(B)': 'mAP @ 0.50–0.95',
    'precision(B)': 'Precision',
    'recall(B)': 'Recall',
    'val/box_loss': 'Box loss',
    'val/cls_loss': 'Classification loss',
    'val/dfl_loss': 'Distribution focal loss',
    accuracy_top1: 'Top-1 accuracy',
    accuracy_top5: 'Top-5 accuracy',
    P: 'Precision',
    R: 'Recall',
  };
  const cleaned = key.replace(/^metrics\//, '');
  return labels[cleaned] ?? cleaned.replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
}
export function metricRows(value: unknown, prefix = ''): { key: string; label: string; value: string }[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, v]) => {
    const path = prefix ? `${prefix} / ${key}` : key;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return metricRows(v, path);
    return [
      {
        key: path,
        label: prefix ? `${readableKey(prefix)} · ${readableKey(key)}` : readableKey(key),
        value:
          typeof v === 'number'
            ? new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(v)
            : Array.isArray(v)
              ? v.join(', ')
              : String(v ?? 'Not recorded'),
      },
    ];
  });
}
export function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  return typeof value === 'object'
    ? JSON.stringify(value)
    : String(value).replaceAll('not-explicitly-stated', 'Not recorded');
}
