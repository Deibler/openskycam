import { useCallback, useRef, useState } from 'react';
import { apiRequest } from '../../../lib/api-request';
import type { WorkshopAnnotation, WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import type { ReviewChange, ReviewDecision } from '../models/reviewInferencemodel';

/**
 * Reviews and labels saved during this visit, laid over the frames as the run loaded them.
 * `onStore` hears every change, for a caller that keeps the frames itself.
 */
export function useReviewDecisions(onStore?: (items: WorkshopRunImage[]) => void) {
  const [saved, setSaved] = useState<Record<string, WorkshopRunImage>>({});
  const queues = useRef(new Map<string, Promise<unknown>>()),
    listener = useRef(onStore);
  listener.current = onStore;
  const latest = useCallback((item: WorkshopRunImage) => saved[item.id] ?? item, [saved]);
  const store = (items: WorkshopRunImage[]) => {
    setSaved(current => ({ ...current, ...Object.fromEntries(items.map(item => [item.id, item])) }));
    listener.current?.(items);
  };

  // Each image's requests run in order, so an undo never lands before the change it reverses.
  function put(item: WorkshopRunImage, review: ReviewDecision, annotations?: WorkshopAnnotation[]) {
    const send = () =>
      apiRequest<{ review: ReviewDecision; annotations?: WorkshopAnnotation[] }>(
        `/api/workshop/items/${encodeURIComponent(item.id)}/review`,
        'PUT',
        { review, ...(annotations ? { annotations } : {}) },
      ).then(value => ({
        ...item,
        review: value.review,
        ...(value.annotations ? { annotation_json: JSON.stringify(value.annotations) } : {}),
      }));
    const next = (queues.current.get(item.id) ?? Promise.resolve()).catch(() => {}).then(send);
    queues.current.set(item.id, next);
    return next;
  }

  /** Saves one image's review and, when given, its labels. Rejects with the server's message. */
  async function save(item: WorkshopRunImage, review: ReviewDecision, annotations?: WorkshopAnnotation[]) {
    const next = await put(item, review, annotations);
    store([next]);
    return next;
  }

  /** Shows every change at once, then saves four at a time. Frames that fail go back to how they were. */
  async function apply(changes: ReviewChange[]) {
    const todo = changes.filter(([item, review, labels]) => item.review !== review || labels);
    store(
      todo.map(([item, review, labels]) => ({
        ...item,
        review,
        ...(labels ? { annotation_json: JSON.stringify(labels) } : {}),
      })),
    );
    const failed: WorkshopRunImage[] = [];
    let next = 0,
      message = '';
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < todo.length) {
          const [item, review, labels] = todo[next++];
          try {
            await put(item, review, labels);
          } catch (e) {
            failed.push(item);
            message ||= e instanceof Error ? e.message : '';
          }
        }
      }),
    );
    store(failed);
    return { failed: failed.length, message };
  }

  return { latest, save, apply };
}
