import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NodeInspector } from '../ui/features/workshop/components/node-inspector';
import { cameraArchive } from '../ui/features/workshop/service/bucketInferenceService';
import { createWorkflow, newStep } from '../ui/features/workshop/service/workflowInferenceService';
import { WorkshopShell } from '../ui/features/workshop/components/workshop-shell';
import type { WorkflowNode, WorkshopCatalog } from '../ui/features/workshop/models/workflowInferencemodel';
import type { ModelCatalogEntry } from '../src/models/modelInferencemodel';

const detector: ModelCatalogEntry = {
  family: 'detector',
  version: 'v1',
  name: 'Road detector',
  description: '',
  task: 'object-detection',
  adapter: 'ultralytics',
  classes: [{ id: 0, name: 'Car' }],
  input: {},
  artifacts: [],
  evaluations: [],
  caveats: [],
  dependencies: [],
  registered_at: '2026-09-23T00:00:00Z',
  creation: { date: null, source: null, legacy_date: null, status: 'not-recorded' },
};
const catalog: WorkshopCatalog = {
  models: [detector, { ...detector, family: 'weather', name: 'Weather classifier', task: 'image-classification' }],
  overview: null,
  loading: false,
  error: '',
};
function Inspector({ node, close = vi.fn() }: { node: WorkflowNode; close?: () => void }) {
  const [current, update] = useState(node);
  return (
    <NodeInspector
      node={current}
      catalog={catalog}
      camera=""
      buckets={[cameraArchive]}
      unavailableBuckets={[]}
      onCreateBucket={vi.fn()}
      onChange={data => update({ ...current, data })}
      onClose={close}
      onRemove={vi.fn()}
      onOpenBucket={vi.fn()}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps searchable model choices inside the inspector and returns to the initiating control', () => {
  render(<Inspector node={createWorkflow('Review').nodes[2]} />);
  const choose = screen.getByRole('button', { name: 'Model version Choose a model' });
  choose.focus();
  fireEvent.click(choose);
  const picker = screen.getByRole('region', { name: 'Choose a workflow model' });
  expect(within(picker).getByRole('heading', { name: 'Choose a model' })).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search models' }), { target: { value: 'road' } });
  expect(within(picker).queryByText('Weather classifier')).toBeNull();
  fireEvent.click(within(picker).getByRole('button', { name: 'Open Road detector' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'Use this version' }));
  const dialog = screen.getByRole('region');
  const selected = within(dialog).getByRole('button', { name: 'Model version Road detector · v1' });
  expect(document.activeElement).toBe(selected);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Parameters Minimum score 50%' }));
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Minimum score' }), { target: { value: '0.75' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Back to step settings' }));
  expect(within(dialog).getByRole('button', { name: 'Parameters Minimum score 75%' })).toBeTruthy();
});
it('uses Escape to go back one level and keeps condition choices contained', () => {
  const close = vi.fn();
  const node = { ...createWorkflow('Review').nodes[2], data: newStep('condition') };
  render(<Inspector node={node} close={close} />);
  const dialog = screen.getByRole('region');
  const time = within(dialog).getByRole('button', { name: 'Recorded 07:00–19:00 UTC' });
  time.focus();
  fireEvent.click(time);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Recorded 07:00–19:00 UTC' }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add check' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Class present' }));
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Class name' }), { target: { value: 'Car' } });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(within(dialog).getByRole('button', { name: 'Car is present Per image' })).toBe(document.activeElement);
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
it('uses a contained sampling page with a selected interval and no dropdown', () => {
  render(<Inspector node={createWorkflow('Review').nodes[1]} />);
  const dialog = screen.getByRole('region');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Extract one frame Every 5 seconds' }));
  expect(within(dialog).getByRole('button', { name: 'Every 5 seconds' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Every 10 seconds' }));
  expect(within(dialog).getByRole('button', { name: 'Extract one frame Every 10 seconds' })).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('keeps the first frame of each interval unless asked to keep the one with the most change', () => {
  render(<Inspector node={createWorkflow('Night').nodes[1]} />);
  const dialog = screen.getByRole('region');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Frame kept First frame' }));
  expect(within(dialog).getByRole('button', { name: /^First frame/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(dialog).getByRole('button', { name: /^Most change/ }));
  expect(within(dialog).getByRole('button', { name: 'Frame kept Most change' })).toBeTruthy();
});
it('hides the navigation rail in the editor while retaining navigation and appearance access', () => {
  const navigate = vi.fn(),
    appearance = vi.fn();
  const props = {
    title: 'Review',
    theme: 'dark',
    onTheme: appearance,
    onNavigate: navigate,
    onExit: vi.fn(),
    children: <p>Canvas</p>,
  };
  const { rerender } = render(<WorkshopShell {...props} page="editor" />);
  expect(screen.queryByRole('navigation', { name: 'Workshop navigation' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Light appearance' }));
  expect(appearance).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Open Workshop navigation' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Overview', exact: true }));
  expect(navigate).toHaveBeenCalledWith('overview');
  expect(screen.queryByRole('dialog')).toBeNull();
  // Reviewing a run beside its video also takes the whole width.
  rerender(<WorkshopShell {...props} page="review" />);
  expect(screen.queryByRole('navigation', { name: 'Workshop navigation' })).toBeNull();
  // Both scroll within themselves, but a bucket's grid scrolls the page, so a phone can reach its end.
  const shell = () => document.querySelector('.wk-shell')!;
  expect(shell().hasAttribute('data-fixed')).toBe(true);
  rerender(<WorkshopShell {...props} page="bucket" />);
  expect(screen.queryByRole('navigation', { name: 'Workshop navigation' })).toBeNull();
  expect(shell().hasAttribute('data-fixed')).toBe(false);
  // A workflow's own page belongs to the overview.
  rerender(<WorkshopShell {...props} page="workflow" />);
  expect(
    within(screen.getByRole('navigation', { name: 'Workshop navigation' }))
      .getByRole('button', { name: 'Overview', exact: true })
      .getAttribute('aria-current'),
  ).toBe('page');
});
