import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelPicker } from '../ui/features/workshop/components/model-picker';
import {
  classFacets,
  filterPickerModels,
  groupPickerModels,
} from '../ui/features/workshop/utils/modelPickerInferenceUtil';
import type { ModelCatalogEntry } from '../src/models/modelInferencemodel';

const base: ModelCatalogEntry = {
  family: 'road',
  version: 'v1',
  name: 'Road detector · compact',
  task: 'object-detection',
  description: 'Detects vehicles in camera frames.',
  adapter: 'ultralytics',
  classes: [{ id: 0, name: 'Car' }],
  input: { training_size: 640 },
  artifacts: [{ sha256: 'a'.repeat(64), bytes: 1000000, filename: 'weights.pt', format: 'pytorch-checkpoint' }],
  evaluations: [],
  caveats: [],
  dependencies: [],
  registered_at: '2026-09-23T00:00:00Z',
  creation: {
    date: '2026-06-06T22:56:46.794272',
    source: 'checkpoint',
    legacy_date: '2026-06-08',
    status: 'available',
  },
};
const models: ModelCatalogEntry[] = [
  base,
  {
    ...base,
    version: 'v2',
    name: 'Road detector · full frame',
    classes: [
      { id: 0, name: 'car' },
      { id: 1, name: 'Truck' },
    ],
    creation: { ...base.creation, date: '2026-07-01' },
  },
  {
    ...base,
    family: 'weather',
    name: 'Weather · compact',
    task: 'image-classification',
    classes: [{ id: 0, name: 'Clear' }],
    creation: { date: null, source: null, legacy_date: null, status: 'not-recorded' },
  },
];
function setup() {
  const choose = vi.fn(),
    back = vi.fn();
  render(
    <ModelPicker
      models={models}
      value="road/v1"
      loading={false}
      error=""
      onChoose={choose}
      onBack={back}
      onClose={vi.fn()}
    />,
  );
  return { choose, back };
}
afterEach(cleanup);

it('groups families and versions, normalizes class filters without altering class IDs, and orders dated versions', () => {
  expect(classFacets(models).find(label => label.key === 'car')).toEqual({ key: 'car', label: 'Car', count: 2 });
  expect(filterPickerModels(models, { query: '', task: 'object-detection', classes: ['car'] })).toHaveLength(2);
  expect(
    filterPickerModels(models, { query: '', task: 'all', classes: ['truck', 'clear'] }).map(model => model.family),
  ).toEqual(['road', 'weather']);
  expect(
    groupPickerModels(models)
      .find(group => group.family === 'road')
      ?.versions.map(model => model.version),
  ).toEqual(['v2', 'v1']);
  expect(models[1].classes[0]).toEqual({ id: 0, name: 'car' });
});
it('combines type and class filters and offers recovery for no results', () => {
  setup();
  expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^View .* details$/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filter by class: Any class' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Truck/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show models' }));
  expect(screen.getByText('1 of 2 versions match')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Weather' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Road detector' }));
  expect(screen.queryByRole('button', { name: 'View Road detector · compact v1 details' })).toBeNull();
  expect(screen.getByRole('button', { name: 'View Road detector · full frame v2 details' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to models' }));
  fireEvent.click(screen.getByRole('button', { name: 'Classifiers' }));
  expect(screen.getByRole('heading', { name: 'No matching models' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2);
});
it('previews creation provenance and classes without selecting, preserves search on Back, and explicitly applies a version', () => {
  const { choose } = setup();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'compact' } });
  const family = screen.getByRole('button', { name: 'Open Road detector' });
  family.focus();
  fireEvent.click(family);
  const details = screen.getByRole('button', { name: 'View Road detector · compact v1 details' });
  details.focus();
  fireEvent.click(details);
  expect(choose).not.toHaveBeenCalled();
  expect(screen.getByText('Recorded in checkpoint')).toBeTruthy();
  expect(screen.getByText('Differs from checkpoint date')).toBeTruthy();
  expect(screen.getByText('Added to library')).toBeTruthy();
  expect(screen.getByText('Sep 23, 2026')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Full model details/ }).getAttribute('href')).toContain('model=road%2Fv1');
  fireEvent.keyDown(screen.getByRole('region', { name: 'Choose a workflow model' }), { key: 'Escape' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View Road detector · compact v1 details' }));
  fireEvent.keyDown(screen.getByRole('region', { name: 'Choose a workflow model' }), { key: 'Escape' });
  expect((screen.getByRole('searchbox', { name: 'Search models' }) as HTMLInputElement).value).toBe('compact');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Road detector' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Road detector' }));
  fireEvent.click(screen.getByRole('button', { name: 'View Road detector · compact v1 details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use this version' }));
  expect(choose).toHaveBeenCalledWith('road/v1');
});
it('keeps missing creation dates distinct from registration dates and never opens a dropdown', () => {
  const { back } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Open Weather' }));
  const details = screen.getByRole('article', { name: 'Weather · compact details' });
  expect(within(details).getByText('Not recorded')).toBeTruthy();
  expect(within(details).getByText('Sep 23, 2026')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(screen.getByRole('region', { name: 'Choose a workflow model' }), { key: 'Escape' });
  expect(back).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('region', { name: 'Choose a workflow model' }), { key: 'Escape' });
  expect(back).toHaveBeenCalledOnce();
});
