import type { ReviewerPreferences } from '../models/reviewInferencemodel';

const key = 'workshop.reviewer';
export function readReviewerPreferences(): ReviewerPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    return { open: value?.open === 'photo' ? 'photo' : 'video', view: value?.view === 'grid' ? 'grid' : 'feed' };
  } catch {
    return { open: 'video', view: 'feed' };
  }
}
export function writeReviewerPreferences(value: ReviewerPreferences) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Reviewing also works when storage is disabled. */
  }
}
