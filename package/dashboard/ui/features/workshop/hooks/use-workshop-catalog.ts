import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';
import { fetchOverview } from '../../../lib/archive/api.js';
import type { ModelCatalogEntry } from '../../../../src/models/modelInferencemodel';
import type { WorkshopCatalog } from '../models/workflowInferencemodel';

export function useWorkshopCatalog() {
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<WorkshopCatalog>({ models: [], overview: null, loading: true, error: '' });
  useEffect(() => {
    const abort = new AbortController();
    setCatalog(previous => ({ ...previous, loading: true, error: '' }));
    void Promise.all([
      apiRequest<{ models: ModelCatalogEntry[] }>('/api/models', 'GET', undefined, abort.signal),
      fetchOverview(null),
    ])
      .then(([models, overview]) => {
        if (!abort.signal.aborted) setCatalog({ models: models.models, overview, loading: false, error: '' });
      })
      .catch(error => {
        if (!abort.signal.aborted)
          setCatalog(previous => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load the archive and models.',
          }));
      });
    return () => abort.abort();
  }, [revision]);
  return { ...catalog, retry: () => setRevision(value => value + 1) };
}
