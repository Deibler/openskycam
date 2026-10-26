import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';
import { restoreWorkshop } from '../service/workshopDraftInferenceService';
import { writeDrafts, preserveBrowserDrafts } from '../db/WorkflowDraftInferenceOps';
import { readDrafts } from '../service/workshopDraftInferenceService';
import { cameraArchive, createBucket, renameBucket, uniqueBucketName } from '../service/bucketInferenceService';
import { createWorkflow } from '../service/workflowInferenceService';
import type { WorkflowDraft, WorkflowMutation, WorkshopDocument } from '../models/workflowInferencemodel';
import type {
  WorkshopDeletionKind,
  WorkshopDeletionPreview,
} from '../../../../src/models/workshopDeletionInferencemodel';

export function useWorkshopDrafts() {
  const [initial] = useState(readDrafts);
  const [document, setDocument] = useState(initial.document);
  const [error, setError] = useState(initial.error);
  const latest = useRef(document);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const cloudRevision = useRef(0),
    hydrated = useRef(false),
    cloudBlocked = useRef(false);
  const cloudPending = useRef(false),
    cloudPromise = useRef<Promise<void> | null>(null);
  const synchronize = useCallback(async (): Promise<void> => {
    if (!hydrated.current || cloudBlocked.current) return;
    if (cloudPromise.current) return cloudPromise.current;
    if (!cloudPending.current) return;
    const operation = async () => {
      setSaving(true);
      try {
        while (cloudPending.current) {
          cloudPending.current = false;
          const next = latest.current;
          const saved = await apiRequest<{ revision: number }>('/api/workshop', 'PUT', {
            revision: cloudRevision.current,
            document: next,
          });
          cloudRevision.current = saved.revision;
          setRevision(saved.revision);
        }
        setError('');
      } catch (error) {
        cloudPending.current = true;
        cloudBlocked.current = true;
        setError(
          `${error instanceof Error ? error.message : 'Cloud save failed.'} Your browser copy is preserved. Reload before continuing.`,
        );
      } finally {
        setSaving(false);
        cloudPromise.current = null;
      }
    };
    cloudPromise.current = operation();
    return cloudPromise.current;
  }, []);
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ revision: number; document: unknown }>('/api/workshop')
      .then(async saved => {
        if (cancelled) return;
        try {
          preserveBrowserDrafts();
        } catch {
          /* Cloud loading remains available when browser storage is full. */
        }
        let document = restoreWorkshop(saved.document);
        // Import existing browser drafts once, only into an empty cloud workspace.
        if (
          saved.revision === 0 &&
          !initial.error &&
          (latest.current.workflows.length || latest.current.buckets.length > 1)
        ) {
          document = latest.current;
          saved = await apiRequest('/api/workshop', 'PUT', {
            revision: 0,
            document,
          });
          if (cancelled) return;
        }
        cloudRevision.current = saved.revision;
        setRevision(saved.revision);
        latest.current = document;
        setDocument(document);
        hydrated.current = true;
        setReady(true);
      })
      .catch(error => {
        if (!cancelled && !initial.error)
          setError(
            `${error instanceof Error ? error.message : 'Workshop could not load.'} Reload to reconnect. Your browser drafts are preserved.`,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [initial.error]);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blocked = Boolean(initial.error);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    if (!blocked) {
      try {
        writeDrafts(latest.current);
        pending.current = false;
      } catch {
        setError(
          hydrated.current
            ? 'Browser backup is unavailable. Cloud saving will continue.'
            : 'Browser storage is unavailable. Changes will be lost when this page closes.',
        );
      }
    }
    if (hydrated.current) void synchronize();
  }, [blocked, synchronize]);
  useEffect(() => {
    const hide = () => {
      if (documentVisibility() === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.document.addEventListener('visibilitychange', hide);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      window.document.removeEventListener('visibilitychange', hide);
    };
  }, [flush]);
  const persist = useCallback(
    (next: WorkshopDocument) => {
      latest.current = next;
      setDocument(next);
      pending.current = true;
      cloudPending.current = true;
      if (hydrated.current) setSaving(!cloudBlocked.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 300);
    },
    [flush],
  );
  const create = useCallback(
    (name: string, inputBucketId = cameraArchive.id): WorkflowDraft => {
      if (latest.current.workflows.length >= 100) throw new Error('Workshop supports up to 100 workflows.');
      const source = latest.current.buckets.find(bucket => bucket.id === inputBucketId);
      if (!source) throw new Error('Choose an available input bucket.');
      const bucket = createBucket(uniqueBucketName(`${name} output`, latest.current.buckets), latest.current.buckets);
      const draft = createWorkflow(name, source, bucket.id);
      persist({
        ...latest.current,
        buckets: [...latest.current.buckets, bucket],
        workflows: [...latest.current.workflows, draft],
      });
      return draft;
    },
    [persist],
  );
  const update = useCallback(
    (id: string, mutation: WorkflowMutation) => {
      persist({
        ...latest.current,
        workflows: latest.current.workflows.map(workflow =>
          workflow.id === id ? { ...mutation(workflow), updatedAt: new Date().toISOString() } : workflow,
        ),
      });
    },
    [persist],
  );
  const addBucket = useCallback(
    (name: string, description = '') => {
      const bucket = createBucket(name, latest.current.buckets, description);
      persist({
        ...latest.current,
        buckets: [...latest.current.buckets, bucket],
      });
      return bucket;
    },
    [persist],
  );
  const editBucket = useCallback(
    (id: string, name: string, description: string) => {
      persist(renameBucket(latest.current, id, name, description));
    },
    [persist],
  );
  const save = useCallback(async () => {
    flush();
    await synchronize();
    if (!hydrated.current || cloudBlocked.current || cloudPending.current)
      throw new Error('Wait for Workshop to finish saving before continuing.');
    return cloudRevision.current;
  }, [flush, synchronize]);
  const prepareDeletion = useCallback(
    async (kind: WorkshopDeletionKind, id: string) => {
      await save();
      return apiRequest<WorkshopDeletionPreview>(
        `/api/workshop/${kind === 'workflow' ? 'workflows' : 'buckets'}/${encodeURIComponent(id)}/deletion`,
      );
    },
    [save],
  );
  const remove = useCallback(
    async (kind: WorkshopDeletionKind, id: string, confirmedRevision: number) => {
      // Flush queued edits first. A stale confirmation must never remove newly changed work.
      const revision = await save();
      if (revision !== confirmedRevision) throw new Error('Workshop changed. Reload and review the deletion again.');
      const saved = await apiRequest<{ revision: number; document: unknown }>(
        `/api/workshop/${kind === 'workflow' ? 'workflows' : 'buckets'}/${encodeURIComponent(id)}`,
        'DELETE',
        { revision },
      );
      const document = restoreWorkshop(saved.document);
      clearTimeout(timer.current);
      pending.current = false;
      cloudPending.current = false;
      cloudRevision.current = saved.revision;
      latest.current = document;
      setRevision(saved.revision);
      setDocument(document);
      setError('');
      try {
        writeDrafts(document);
      } catch {
        setError('Deleted from Cloudflare. Browser backup is unavailable.');
      }
    },
    [save],
  );
  return {
    ready,
    saving,
    saveFailed: cloudBlocked.current,
    revision,
    save,
    workflows: document.workflows,
    buckets: document.buckets,
    error,
    create,
    update,
    addBucket,
    editBucket,
    prepareDeletion,
    remove,
  };
}
function documentVisibility() {
  return window.document.visibilityState;
}
