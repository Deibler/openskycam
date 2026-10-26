import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';
import type { WorkshopRunReview } from '../../../../src/models/workshopInferencemodel';
import { groupSightings } from '../utils/sightingInferenceUtil';

/** Read-only run summary, refreshed when processing progress changes. */
export function useRunReview(id: string, version: unknown = 0) {
  const [review, setReview] = useState<WorkshopRunReview | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<WorkshopRunReview>(
      `/api/workshop/runs/${encodeURIComponent(id)}/review`,
      'GET',
      undefined,
      controller.signal,
    )
      .then(value => {
        if (!controller.signal.aborted) {
          setReview(value);
          setError('');
        }
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not open this run.');
      });
    return () => controller.abort();
  }, [id, revision, version]);
  const sightings = useMemo(() => groupSightings(review?.items ?? []), [review]);
  return { review, sightings, error, reload: () => setRevision(value => value + 1) };
}
