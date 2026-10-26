// Thin wrappers over the dashboard API (dashboard/src/routes). Shapes are documented as JSDoc types.

import { compactTimestamp } from './format.js';

/**
 * @typedef {{ segments: number, bytes: number, seconds: number }} Totals
 * @typedef {Totals & { day: string }} DaySummary
 * @typedef {{
 *   viewer: { email: string },
 *   cameras: string[],
 *   cam: string,
 *   generated_at: string,
 *   health: { healthy: boolean, newest_start: string | null, newest_uploaded_at: string | null, age_seconds: number | null },
 *   last_24h: Totals,
 *   retained: Totals,
 *   days: DaySummary[],
 *   projection: { bytes_per_day: number | null, steady_state_bytes: number | null },
 * }} Overview
 * @typedef {{
 *   start: string, size: number, duration_s: number | null, frames: number | null,
 *   width: number | null, height: number | null, bitrate: number | null, codec: string | null,
 * }} Segment
 */

/** Raised when the Access session has ended; the page must reload to sign in again. */
export class SessionExpiredError extends Error {}

/**
 * @template T
 * @param {string} path
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
async function getJson(path, signal) {
  let response;
  try {
    response = await fetch(path, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Check your connection and try again. If this continues, reload to sign in.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError('Your session has ended.');
  }
  if (!response.ok) {
    throw new Error(`The archive returned an error (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new SessionExpiredError('Your session has ended.');
  return response.json();
}

/** @param {string | null} cam @returns {Promise<Overview>} */
export function fetchOverview(cam) {
  return getJson(cam ? `/api/overview?cam=${encodeURIComponent(cam)}` : '/api/overview');
}

/**
 * Segments that started in [from, to).
 * @param {string} cam @param {Date} from @param {Date} to @param {AbortSignal} [signal]
 * @returns {Promise<Segment[]>}
 */
export async function fetchSegments(cam, from, to, signal) {
  const query = new URLSearchParams({ cam, from: from.toISOString(), to: to.toISOString() });
  /** @type {{ segments: Segment[] }} */
  const body = await getJson(`/api/segments?${query}`, signal);
  return body.segments;
}

/** @param {string} cam @param {Date[]} boundaries @param {AbortSignal} [signal] @returns {Promise<string[]>} */
export async function fetchAvailableDays(cam, boundaries, signal) {
  const query = new URLSearchParams({ cam, boundaries: boundaries.map(date => date.getTime()).join(',') });
  /** @type {{ days: string[] }} */
  const body = await getJson(`/api/availability?${query}`, signal);
  return body.days;
}

/** @param {string} cam @param {Segment} segment */
export function videoUrl(cam, segment) {
  return `/api/video/${encodeURIComponent(cam)}/${compactTimestamp(new Date(segment.start))}`;
}

/** @param {string} cam @param {Segment} segment */
export function downloadUrl(cam, segment) {
  return `${videoUrl(cam, segment)}?download`;
}
