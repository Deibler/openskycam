import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeleteWorkshopDialog } from '../ui/features/workshop/components/delete-workshop-dialog';
import { WorkflowDetail } from '../ui/features/workshop/components/workflow-detail';
import { BucketList } from '../ui/features/workshop/components/bucket-list';
import { useWorkshopDrafts } from '../ui/features/workshop/hooks/use-workshop-drafts';
import { readDrafts } from '../ui/features/workshop/service/workshopDraftInferenceService';
import { cameraArchive, createBucket } from '../ui/features/workshop/service/bucketInferenceService';
import { createWorkflow } from '../ui/features/workshop/service/workflowInferenceService';
import type { WorkshopDeletionPreview } from '../src/models/workshopDeletionInferencemodel';
import type { WorkshopDocument } from '../ui/features/workshop/models/workflowInferencemodel';

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const preview: WorkshopDeletionPreview = {
  kind: 'bucket',
  id: 'labels',
  name: 'Birds',
  revision: 4,
  images: 24,
  saved_images: 2,
  versions: 1,
  active_runs: 1,
  linked_workflows: [{ id: 'find', name: 'Find birds' }],
};

it('shows consequences and waits for a deliberate confirmation, with cancel focused first', async () => {
  const close = vi.fn(),
    remove = vi.fn();
  let resolve!: (p: WorkshopDeletionPreview) => void;
  const prepare = vi.fn(
    () =>
      new Promise<WorkshopDeletionPreview>(done => {
        resolve = done;
      }),
  );
  render(
    <DeleteWorkshopDialog
      target={{ kind: 'bucket', id: 'labels', name: 'Birds' }}
      onPrepare={prepare}
      onDelete={remove}
      onClose={close}
    />,
  );
  expect(screen.getByRole('button', { name: 'Delete bucket' }).hasAttribute('disabled')).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => {
    resolve(preview);
  });
  expect(screen.getByText('Find birds')).toBeTruthy();
  expect(screen.getByText('2 saved')).toBeTruthy();
  expect(screen.getByText('1 unfinished run will be cancelled.')).toBeTruthy();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
});
it('prevents repeated submission and keeps a failed deletion visible', async () => {
  let reject!: (reason: Error) => void;
  const remove = vi.fn(
      () =>
        new Promise<void>((_done, failed) => {
          reject = failed;
        }),
    ),
    close = vi.fn();
  render(
    <DeleteWorkshopDialog
      target={{ kind: 'bucket', id: 'labels', name: 'Birds' }}
      onPrepare={async () => preview}
      onDelete={remove}
      onClose={close}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete bucket' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete bucket' }));
  expect(remove).toHaveBeenCalledWith('bucket', 'labels', 4);
  expect(screen.getByRole('button', { name: 'Deleting…' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  await act(async () => {
    reject(new Error('Workshop changed. Reload and review the deletion again.'));
  });
  expect(screen.getByRole('alert').textContent).toContain('Workshop changed');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Delete bucket' }).hasAttribute('disabled')).toBe(false);
});
it('exposes separate delete actions without opening the row or offering deletion of the raw archive', () => {
  const bucket = createBucket('Birds', [cameraArchive]),
    workflow = createWorkflow('Find birds', cameraArchive, bucket.id);
  const remove = vi.fn(),
    open = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ runs: [] }), { headers: { 'Content-Type': 'application/json' } })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const { unmount } = render(
    <WorkflowDetail
      workflow={workflow}
      workflows={[workflow]}
      buckets={[cameraArchive, bucket]}
      catalog={{ models: [], overview: null, loading: false, error: '' }}
      summary={null}
      theme="light"
      onBack={vi.fn()}
      onEdit={open}
      onDelete={() => remove(workflow.id)}
      onRun={open}
      onReview={open}
      onBucket={open}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete workflow' }));
  expect(remove).toHaveBeenCalledWith(workflow.id);
  expect(open).not.toHaveBeenCalled();
  unmount();
  render(
    <BucketList
      buckets={[cameraArchive, bucket]}
      workflows={[workflow]}
      summary={null}
      onOpen={open}
      onCreate={vi.fn()}
      onDelete={remove}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete Birds' }));
  expect(remove).toHaveBeenCalledWith(bucket.id);
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Delete Camera archive' })).toBeNull();
});
it('flushes pending edits before deletion and never autosaves the deleted workflow back to Cloudflare', async () => {
  const bucket = createBucket('Birds', [cameraArchive]),
    workflow = createWorkflow('Find birds', cameraArchive, bucket.id);
  let cloud = {
    revision: 3,
    document: { version: 3, workflows: [workflow], buckets: [cameraArchive, bucket] } as WorkshopDocument,
  };
  const methods: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'PUT') {
        const value = JSON.parse(String(init?.body));
        expect(value.revision).toBe(cloud.revision);
        cloud = { revision: cloud.revision + 1, document: value.document };
      }
      if (method === 'DELETE') {
        expect(JSON.parse(String(init?.body)).revision).toBe(cloud.revision);
        cloud = { revision: cloud.revision + 1, document: { ...cloud.document, workflows: [] } };
      }
      const response = path.endsWith('/deletion')
        ? {
            ...preview,
            kind: 'workflow',
            id: workflow.id,
            name: cloud.document.workflows[0].name,
            revision: cloud.revision,
          }
        : cloud;
      return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  const { result } = renderHook(useWorkshopDrafts);
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.update(workflow.id, w => ({ ...w, name: 'Updated before delete' })));
  let revision = 0;
  await act(async () => {
    const p = await result.current.prepareDeletion('workflow', workflow.id);
    revision = p.revision;
    expect(p.name).toBe('Updated before delete');
  });
  expect(methods).toEqual(['GET', 'PUT', 'GET']);
  await act(async () => {
    await result.current.remove('workflow', workflow.id, revision);
  });
  expect(result.current.workflows).toEqual([]);
  expect(result.current.buckets).toHaveLength(2);
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(methods).toEqual(['GET', 'PUT', 'GET', 'DELETE']);
  expect(readDrafts().document.workflows).toEqual([]);
  act(() => result.current.editBucket(bucket.id, 'Keep this bucket', ''));
  await act(async () => {
    await result.current.save();
  });
  expect(cloud.document.workflows).toEqual([]);
  expect(cloud.document.buckets[1].name).toBe('Keep this bucket');
});
