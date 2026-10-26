import type { ModelCatalogEntry } from '../../../../src/models/modelInferencemodel';
import type { ModelClassFacet, ModelPickerFilters, ModelPickerGroup } from '../models/modelPickerInferencemodel';
import { matchesModel } from '../../../lib/model-library';

export const classKey = (value: string) => value.trim().toLocaleLowerCase();
export const familyName = (model: ModelCatalogEntry) => model.name.split(' · ')[0];
export const variantName = (model: ModelCatalogEntry) =>
  model.name.includes(' · ') ? model.name.split(' · ').slice(1).join(' · ') : model.version;

export function filterPickerModels(models: ModelCatalogEntry[], filters: ModelPickerFilters) {
  return models.filter(
    model =>
      (filters.task === 'all' || model.task === filters.task) &&
      matchesModel(model, filters.query) &&
      (!filters.classes.length || model.classes.some(label => filters.classes.includes(classKey(label.name)))),
  );
}
export function classFacets(models: ModelCatalogEntry[]): ModelClassFacet[] {
  const facets = new Map<string, ModelClassFacet>();
  for (const model of models) {
    for (const key of new Set(model.classes.map(label => classKey(label.name)))) {
      const current = facets.get(key);
      facets.set(key, {
        key,
        label: current?.label ?? model.classes.find(label => classKey(label.name) === key)!.name,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  return [...facets.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export function groupPickerModels(models: ModelCatalogEntry[]): ModelPickerGroup[] {
  const groups = new Map<string, ModelPickerGroup>();
  for (const model of models) {
    const key = `${model.task}/${model.family}`;
    const group = groups.get(key) ?? { family: model.family, name: familyName(model), task: model.task, versions: [] };
    group.versions.push(model);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.task.localeCompare(a.task) || a.name.localeCompare(b.name))
    .map(group => ({
      ...group,
      versions: group.versions.sort(
        (a, b) =>
          (b.creation?.date ?? '').localeCompare(a.creation?.date ?? '') ||
          b.version.localeCompare(a.version, undefined, { numeric: true }),
      ),
    }));
}
export function modelDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        date,
      )
    : 'Not recorded';
}
export function creationLabel(model: ModelCatalogEntry) {
  return model.creation?.status === 'unavailable'
    ? 'Date unavailable'
    : model.creation?.date
      ? `Created ${modelDate(model.creation.date)}`
      : 'Creation date not recorded';
}
