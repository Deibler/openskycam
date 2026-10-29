import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
import type {
  Workflow,
  WorkshopScheduleDue,
  WorkshopScheduleOutcome,
  WorkshopScheduleStep,
  WorkshopState,
} from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopScheduleInferenceOps';
import { run as existingRun } from '../db/WorkshopInferenceOps';
import { createRun, loadWorkshop } from './workshopInferenceService';
import { arrivalMinutes, noMedia } from './workshopValidationInferenceService';

// ponytail: fixed cadences. The cron fires every minute; these decide how often each trigger acts.
const slotGrace = 60 * 60000; // a set-time slot still starts if the scheduler missed its minute
const followLookback = 60 * 60000; // a new follow schedule ignores upstream runs older than this

async function due(
  env: Env,
  state: WorkshopState,
  s: WorkshopScheduleStep,
  since: string | null,
  now: Date,
): Promise<WorkshopScheduleDue | null> {
  if (s.trigger === 'time') {
    if (!/^\d\d:\d\d$/.test(s.at)) return null;
    for (const back of [0, 1]) {
      // Yesterday's slot covers a scheduler minute missed just before midnight.
      const slot = new Date(`${new Date(+now - back * 86400000).toISOString().slice(0, 10)}T${s.at}:00Z`);
      if (s.days.includes(slot.getUTCDay()) && slot <= now && +now - +slot < slotGrace)
        return { key: slot.toISOString(), label: `Scheduled ${s.at} UTC`, slot };
    }
    return null;
  }
  if (s.trigger === 'arrival') {
    const step = arrivalMinutes * 60000;
    return { key: new Date(Math.floor(+now / step) * step).toISOString(), label: 'New footage' };
  }
  const upstream = await ops.finishedRun(env, s.workflowId, since ?? new Date(+now - followLookback).toISOString());
  if (!upstream) return null;
  const name = state.document.workflows.find(w => w.id === s.workflowId)?.name ?? 'another workflow';
  return { key: `after:${upstream.id}`, label: `After ${name}`, found: upstream.images > 0 };
}

async function runSchedule(env: Env, state: WorkshopState, workflow: Workflow, s: WorkshopScheduleStep, now: Date) {
  const since = await ops.lastScheduledRun(env, workflow.id);
  const trigger = await due(env, state, s, since, now);
  if (!trigger) return;
  const last = await ops.outcome(env, workflow.id);
  if (last?.trigger_key === trigger.key && last.status !== 'failed') return;
  const id = `sched_${(await sha256(`${workflow.id}|${trigger.key}`)).slice(0, 32)}`;
  const record = (status: WorkshopScheduleOutcome['status'], message: string, run_id: string | null = null) =>
    ops.recordOutcome(env, {
      workflow_id: workflow.id,
      trigger_key: trigger.key,
      status,
      message,
      run_id,
      checked_at: now.toISOString(),
    });
  if (await existingRun(env, id)) return record('started', trigger.label, id);
  if (s.onlyIf && trigger.found === false) return record('skipped', 'The followed run saved no images.');
  const runtime = await ops.activeRuntime(env);
  if (!runtime) return record('failed', 'No Workshop processor has checked in yet.');
  // Raw footage reruns its whole window except on arrival; labeled buckets always take only new images.
  const raw = workflow.nodes.some(n => n.data.kind === 'input' && n.data.bucketId === 'camera-archive');
  try {
    await createRun(
      env,
      { id, workflow_id: workflow.id, runtime_id: runtime.id, revision: state.revision, mode: 'run' },
      // A slot that starts late, after midnight, still processes the day of its slot.
      {
        now: trigger.slot ?? now,
        name: `${workflow.name} · ${trigger.label}`,
        ...(raw && s.trigger !== 'arrival' ? {} : { since }),
      },
    );
    await record('started', trigger.label, id);
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    const quiet = error.message === noMedia && (s.trigger === 'arrival' || s.onlyIf);
    await record(quiet ? 'skipped' : 'failed', quiet ? 'Nothing new to process.' : error.message);
  }
}

/** Called every minute by the cron trigger. */
export async function runSchedules(env: Env, now = new Date()) {
  const state = await loadWorkshop(env);
  for (const workflow of state.document.workflows) {
    const node = workflow.nodes.find(n => n.data.kind === 'schedule');
    if (!node) continue;
    try {
      await runSchedule(env, state, workflow, node.data as unknown as WorkshopScheduleStep, now);
    } catch (error) {
      console.error('Workshop schedule failed', workflow.id, error); // one workflow never blocks the others
    }
  }
}

export const scheduleOutcomes = async (env: Env) => ({ schedules: await ops.outcomes(env) });
