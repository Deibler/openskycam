import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunOutput } from '../ui/features/workshop/components/run-output';
import type { WorkshopRunDetail } from '../src/models/workshopInferencemodel';
const run: WorkshopRunDetail = {
  id: 'run',
  name: 'Example',
  workflow_id: 'flow',
  mode: 'test',
  status: 'running',
  created_at: '2026-09-24T00:00:00Z',
  preview_expires_at: '2026-09-24T01:00:00Z',
  requested_images: 3,
  expected_images: 3,
  processed_images: 1,
  output_buckets: [],
  workflow: {
    id: 'flow',
    name: 'Example',
    updatedAt: '',
    nodes: [{ id: 'model', type: 'workshop', position: { x: 0, y: 0 }, data: { kind: 'model', label: 'Sky model' } }],
    edges: [],
  },
  jobs: [
    {
      id: 'job',
      status: 'leased',
      expected: 3,
      processed: 1,
      error: null,
      progress: { phase: 'processing', node_id: 'model', processed: 1, updated_at: '' },
    },
  ],
  images: [
    {
      id: 'preview',
      image_url: '/api/workshop/runs/run/previews/preview/image',
      bucket_id: 'never-saved',
      asset_id: 'a',
      run_id: 'run',
      job_id: 'job',
      source_sha256: 's',
      cam: 'sky01',
      captured_at: '2026-09-24T00:00:00Z',
      object_key: 'workshop-tests/test.jpg',
      sha256: 's',
      expires_at: '2026-09-24T01:00:00Z',
      annotation_json: '[]',
      provenance_json: '{"width":3840,"height":2160}',
      review: 'pending',
      created_at: '',
    },
  ],
  steps: [{ id: 'model', kind: 'model', label: 'Sky model' }],
  has_more: false,
};
afterEach(cleanup);
it('shows live test output through the preview route with no save or review controls', () => {
  const cancel = vi.fn();
  render(<RunOutput run={run} error="" onCancel={cancel} onRefresh={() => {}} compact />);
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('1');
  expect(screen.getByText('Sky model')).toBeTruthy();
  expect(screen.getByRole('img').getAttribute('src')).toBe(run.images[0].image_url);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Save|Accept|Review output/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel test' }));
  expect(cancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /Inspect frame at/ }));
  expect(screen.getByRole('dialog').querySelector('image')?.getAttribute('href')).toBe(run.images[0].image_url);
});
it('keeps failed progress honest rather than filling the bar or hiding errors', () => {
  render(
    <RunOutput
      run={{ ...run, status: 'failed', jobs: [{ ...run.jobs[0], status: 'failed', error: 'decode_failed' }] }}
      error=""
      onCancel={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText('Finished with errors')).toBeTruthy();
  expect(screen.getByText(/decode failed/)).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('1');
  expect(screen.queryByRole('button', { name: 'Cancel test' })).toBeNull();
});
it('keeps one layout skeleton whichever step is live, and between recordings', () => {
  const live = {
    ...run,
    mode: 'run' as const,
    expected_images: 759,
    steps: [
      { id: 'model', kind: 'model', label: 'Sky model' },
      { id: 'gate', kind: 'condition', label: 'Has wildlife' },
    ],
  };
  const shape = (e: Element): string => e.tagName + '(' + [...e.children].map(shape).join(',') + ')';
  const skeleton = (processed: number, node_id: string | null, status: 'leased' | 'completed' = 'leased') => {
    const { container } = render(
      <RunOutput
        run={{
          ...live,
          processed_images: processed,
          jobs: [{ ...run.jobs[0], status, progress: node_id ? { ...run.jobs[0].progress!, node_id } : null }],
        }}
        error=""
        onCancel={() => {}}
        onRefresh={() => {}}
      />,
    );
    const out =
      [...container.querySelectorAll('.wk-run-progress,.wk-run-steps')].map(shape).join('|') +
      container.querySelector<HTMLElement>('.wk-run-count strong')!.style.minWidth;
    cleanup();
    return out;
  };
  const shapes = [skeleton(12, 'model'), skeleton(125, 'gate'), skeleton(125, null), skeleton(130, null, 'completed')];
  expect(shapes[0]).toContain('3ch');
  expect(new Set(shapes).size).toBe(1);
});
