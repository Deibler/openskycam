import type { WorkshopDocument } from '../models/workflowInferencemodel';
const KEY = 'openskycam-workshop-v1';
export function readStoredDrafts(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  return storage.getItem(KEY);
}
export function writeDrafts(document: WorkshopDocument, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(KEY, JSON.stringify(document));
}

/** Preserve the pre-cloud browser document before any connected edit overwrites the cache. */
export function preserveBrowserDrafts(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const original = storage.getItem('openskycam-workshop-v1');
  if (original && !storage.getItem('openskycam-workshop-before-cloud-v1'))
    storage.setItem('openskycam-workshop-before-cloud-v1', original);
}
