import type { Env } from '../models/applicationSharedmodel';
import type { WorkshopRunDetail } from '../models/workshopInferencemodel';
import { runDetail } from './workshopRunInferenceService';

/** Tell the open run view that something changed. A missing binding or a closed room does not fail the job. */
export async function publishRun(env: Env, id: string) {
  const sessions = env.RUN_SESSIONS;
  if (!sessions) return;
  try {
    await sessions.get(sessions.idFromName(id)).fetch('https://workshop-run/notify', { method: 'POST' });
  } catch {
    /* The processor result is already saved. */
  }
}

/** What an observer can see move: status, counts, and each recording's phase and step. */
export const runProgress = (d: WorkshopRunDetail) =>
  JSON.stringify([
    d.status,
    d.processed_images,
    d.images.length,
    d.jobs.map(j => [j.status, j.processed, j.progress?.phase, j.progress?.node_id]),
  ]);
export const runFinished = (d: WorkshopRunDetail) => !['queued', 'running'].includes(d.status);

/**
 * The run as soon as its progress changes or it finishes, or as it is after `ms`.
 * Joins the same live session the website uses, so it wakes on the processor's own updates.
 */
export async function nextRunUpdate(
  env: Env,
  id: string,
  ms: number,
): Promise<{ detail: WorkshopRunDetail; changed: boolean }> {
  const initial = await runDetail(env, id),
    seen = runProgress(initial);
  if (runFinished(initial) || ms <= 0) return { detail: initial, changed: false };
  const socket = env.RUN_SESSIONS
    ? (
        await env.RUN_SESSIONS.get(env.RUN_SESSIONS.idFromName(id)).fetch('https://workshop-run/watch', {
          headers: { Upgrade: 'websocket' },
        })
      ).webSocket
    : null;
  if (!socket) {
    await new Promise(resolve => setTimeout(resolve, ms));
    const detail = await runDetail(env, id);
    return { detail, changed: runProgress(detail) !== seen };
  }
  socket.accept();
  return new Promise(resolve => {
    let latest = initial;
    const finish = () => {
      clearTimeout(timer);
      try {
        socket.close(1000, 'done');
      } catch {
        /* Already closed. */
      }
      resolve({ detail: latest, changed: runProgress(latest) !== seen });
    };
    const timer = setTimeout(finish, ms);
    socket.addEventListener('message', event => {
      try {
        const detail = JSON.parse(String(event.data)) as WorkshopRunDetail & { error?: string };
        if (detail.error) return;
        latest = detail;
        if (runProgress(detail) !== seen || runFinished(detail)) finish();
      } catch {
        /* Ignore a malformed update; the timer still ends the wait. */
      }
    });
    socket.addEventListener('close', finish);
  });
}
