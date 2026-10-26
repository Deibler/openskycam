import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';
import type { BucketBrowsePage } from '../../../../src/models/bucketBrowseInferencemodel';
import type { WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { BrowserFilters } from '../models/browserInferencemodel';
import { browserQuery } from '../utils/browserInferenceUtil';

export function useBucketBrowser(bucket: string, filters: BrowserFilters) {
  const query = browserQuery(filters);
  const [page, setPage] = useState<BucketBrowsePage | null>(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null),
    loadingMore = useRef(false);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    loadingMore.current = false;
    setLoading(true);
    setMore(false);
    setError('');
    setPage(current => current && { ...current, items: [], total: 0, cursor: null });
    const timer = setTimeout(() => {
      void apiRequest<BucketBrowsePage>(
        `/api/workshop/buckets/${encodeURIComponent(bucket)}/browse?${query}`,
        'GET',
        undefined,
        request.signal,
      )
        .then(value => {
          if (!request.signal.aborted) setPage(value);
        })
        .catch(e => {
          if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load detections.');
        })
        .finally(() => {
          if (!request.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [bucket, query, revision]);
  async function loadMore() {
    if (!page?.cursor || loading || loadingMore.current) return;
    const request = controller.current!;
    loadingMore.current = true;
    setMore(true);
    setError('');
    try {
      const value = await apiRequest<BucketBrowsePage>(
        `/api/workshop/buckets/${encodeURIComponent(bucket)}/browse?${query}&cursor=${encodeURIComponent(page.cursor)}`,
        'GET',
        undefined,
        request.signal,
      );
      if (!request.signal.aborted)
        setPage(
          current =>
            current && {
              ...value,
              items: [...current.items, ...value.items.filter(item => !current.items.some(old => old.id === item.id))],
            },
        );
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load more detections.');
    } finally {
      if (!request.signal.aborted) {
        loadingMore.current = false;
        setMore(false);
      }
    }
  }
  const updateItem = useCallback(
    (item: WorkshopRunImage) =>
      setPage(current => current && { ...current, items: current.items.map(old => (old.id === item.id ? item : old)) }),
    [],
  );
  const reload = useCallback(() => setRevision(value => value + 1), []);
  return { page, error, loading, more, loadMore, updateItem, reload };
}
