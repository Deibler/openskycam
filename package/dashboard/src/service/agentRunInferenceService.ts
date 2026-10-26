import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { MachineApp } from '../models/applicationSharedmodel';
import type { AgentTool } from '../models/agentSharedmodel';
import type { WorkshopRunDetail, WorkshopRunStatus, WorkshopSnapshot } from '../models/workshopInferencemodel';
import { activeRuntime } from '../db/WorkshopScheduleInferenceOps';
import { run as findRun, runsAhead } from '../db/WorkshopInferenceOps';
import { action, detections, number, reply, text } from '../utils/agentSharedUtil';
import { requireApiCamera } from './credentialSharedService';
import {
  cancelRun,
  createRun,
  listRuns,
  loadWorkshop,
  photoWorkflowId,
  registerRuntime,
  runtimeStatus,
} from './workshopInferenceService';
import { runDetail } from './workshopRunInferenceService';
import { nextRunUpdate, runFinished } from './workshopLiveInferenceService';
import { scheduleOutcomes } from './workshopScheduleInferenceService';

const actions = [
  'list',
  'start',
  'test',
  'status',
  'watch',
  'cancel',
  'schedules',
  'runtimes',
  'register_runtime',
] as const;

function listed(r: WorkshopRunStatus) {
  const snapshot = JSON.parse(r.snapshot_json) as WorkshopSnapshot;
  const status = r.leased
    ? 'running'
    : r.queued
      ? 'queued'
      : r.failed
        ? 'failed'
        : r.cancelled
          ? 'cancelled'
          : r.expired
            ? 'expired'
            : 'completed';
  return {
    run_id: r.id,
    name: r.name,
    workflow_id: r.workflow_id,
    mode: snapshot.mode ?? 'run',
    status,
    created_at: r.created_at,
    recordings: { total: r.total, completed: r.completed, failed: r.failed },
    expected_images: snapshot.expected_images ?? null,
    saved_images: r.images,
  };
}

/** A run as an observer needs it: overall progress, what each busy recording is doing, and failures. */
export function runView(d: WorkshopRunDetail) {
  const step = (id?: string | null) => d.steps.find(s => s.id === id)?.label ?? null;
  const count = (status: string) => d.jobs.filter(j => j.status === status).length;
  return {
    run_id: d.id,
    name: d.name,
    workflow_id: d.workflow_id,
    mode: d.mode,
    status: d.status,
    created_at: d.created_at,
    images: {
      processed: d.processed_images,
      expected: d.expected_images,
      percent: Math.floor((100 * d.processed_images) / Math.max(1, d.expected_images)),
    },
    recordings: {
      total: d.jobs.length,
      completed: count('completed'),
      running: count('leased'),
      queued: count('queued'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      expired: count('expired'),
    },
    working_on: d.jobs
      .filter(j => j.status === 'leased')
      .map(j => ({
        job_id: j.id,
        phase: j.progress?.phase ?? 'starting',
        step: step(j.progress?.node_id),
        processed: j.processed,
        expected: j.expected,
      })),
    errors: d.jobs
      .filter(j => j.error)
      .slice(0, 5)
      .map(j => ({ job_id: j.id, error: j.error })),
    output_buckets: d.output_buckets,
    ...(d.mode === 'test' ? { previews_expire_at: d.preview_expires_at } : {}),
    latest_images: d.images
      .slice(0, 5)
      .map(i => ({ image_id: i.id, captured_at: i.captured_at, detections: detections(i.annotation_json, 5) })),
    images_listed: d.images.length,
    more_images: d.has_more,
  };
}

/** The processor runs one workflow at a time; a queued run lists the runs it waits behind. */
async function waitingBehind(app: MachineApp, id: string) {
  const run = await findRun(app.env, id);
  return run
    ? (await runsAhead(app.env, run, photoWorkflowId, new Date().toISOString())).map(r => ({
        run_id: r.id,
        name: r.name,
      }))
    : [];
}
async function observed(app: MachineApp, d: WorkshopRunDetail) {
  return { ...runView(d), ...(d.status === 'queued' ? { waiting_behind: await waitingBehind(app, d.id) } : {}) };
}

async function start(app: MachineApp, args: JsonObject, mode: 'run' | 'test') {
  const id = text(args, 'workflow_id', true)!;
  const state = await loadWorkshop(app.env),
    workflow = state.document.workflows.find(w => w.id === id);
  if (!workflow) throw new ApplicationError('not_found', 'Workflow not found. workflows list shows their IDs.');
  const input = workflow.nodes.find(n => n.data.kind === 'input');
  if (input?.data.bucketId === 'camera-archive') requireApiCamera(app.principal, String(input.data.camera ?? ''));
  const runtime = await activeRuntime(app.env);
  if (!runtime)
    throw new ApplicationError('unavailable', 'No Workshop processor has checked in. runs runtimes shows processors.');
  const run = await createRun(app.env, {
    id: crypto.randomUUID(),
    workflow_id: id,
    runtime_id: runtime.id,
    revision: state.revision,
    mode,
    ...(mode === 'test' ? { image_limit: number(args, 'image_limit', 1, 100, 10) } : {}),
  });
  const snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot,
    behind = await waitingBehind(app, run.id);
  return reply(
    {
      run_id: run.id,
      name: run.name,
      mode,
      expected_images: snapshot.expected_images,
      window: snapshot.from ? { from: snapshot.from, until: snapshot.until } : null,
      processor: runtime.id,
      waiting_behind: behind,
    },
    `${behind.length ? 'Queued: the processor runs one workflow at a time and starts this when the runs above finish. ' : ''}Follow it live with runs watch run_id=${run.id}; each call returns as soon as progress changes.`,
  );
}

async function watch(app: MachineApp, args: JsonObject) {
  const id = text(args, 'run_id', true)!;
  const { detail, changed } = await nextRunUpdate(app.env, id, number(args, 'wait_seconds', 0, 45, 30) * 1000);
  const finished = runFinished(detail);
  return reply(
    { changed, finished, ...(await observed(app, detail)) },
    !finished
      ? 'Call runs watch again to keep following.'
      : detail.mode === 'test'
        ? `Finished. Look at previews with images view run_id=${id}.`
        : `Finished. Check results with images search run_id=${id}.`,
  );
}

async function schedules(app: MachineApp) {
  const [state, { schedules: outcomes }] = await Promise.all([loadWorkshop(app.env), scheduleOutcomes(app.env)]);
  return reply(
    {
      schedules: state.document.workflows.flatMap(w => {
        const s = w.nodes.find(n => n.data.kind === 'schedule')?.data;
        const last = outcomes.find(o => o.workflow_id === w.id);
        return s
          ? [
              {
                workflow_id: w.id,
                workflow: w.name,
                trigger: s.trigger,
                days: s.days,
                at_utc: s.at,
                follows: s.workflowId || null,
                only_if: s.onlyIf,
                last_check: last
                  ? { status: last.status, message: last.message, run_id: last.run_id, checked_at: last.checked_at }
                  : null,
              },
            ]
          : [];
      }),
    },
    'Change a schedule by editing its schedule step with workflows update.',
  );
}

async function runs(app: MachineApp, args: JsonObject) {
  switch (action(args, actions)) {
    case 'list': {
      const workflow = text(args, 'workflow_id'),
        limit = number(args, 'limit', 1, 100, 20);
      const rows = (await listRuns(app.env, workflow ?? null)).slice(0, limit);
      return reply({ runs: rows.map(listed) });
    }
    case 'start':
      return start(app, args, 'run');
    case 'test':
      return start(app, args, 'test');
    case 'status':
      return reply(await observed(app, await runDetail(app.env, text(args, 'run_id', true)!)));
    case 'watch':
      return watch(app, args);
    case 'cancel':
      return reply(await cancelRun(app.env, text(args, 'run_id', true)!), 'Confirm with runs status.');
    case 'schedules':
      return schedules(app);
    case 'runtimes':
      return reply(await runtimeStatus(app.env));
    default:
      return reply(
        await registerRuntime(app.env, {
          device_id: text(args, 'device_id', true),
          code_sha256: text(args, 'code_sha256', true),
        }),
        'The processor starts claiming work once it runs with this runtime ID.',
      );
  }
}

export const runsTool: AgentTool = {
  name: 'runs',
  title: 'Workflow runs',
  description:
    'Run workflows on the processor and follow them live. The processor runs one workflow at a time: a run started while another is unfinished waits in the queue (waiting_behind lists what is ahead). Actions: list; test (a quick run on image_limit frames whose results are temporary previews; do this first); start (the full run, saving into output buckets); status; watch (waits up to wait_seconds and returns as soon as progress changes or the run finishes; call repeatedly to follow live); cancel; schedules (every scheduled workflow and its last check); runtimes and register_runtime (processor versions). Read guide runs first.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...actions] },
      workflow_id: { type: 'string', description: 'start/test: the workflow. list: only its runs' },
      run_id: { type: 'string', description: 'status/watch/cancel' },
      image_limit: { type: 'integer', minimum: 1, maximum: 100, description: 'test: frames to process (default 10)' },
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        maximum: 45,
        description: 'watch: longest wait for a change (default 30)',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'list: how many (default 20)' },
      device_id: { type: 'string', description: "register_runtime: the processor's registered device" },
      code_sha256: { type: 'string', description: 'register_runtime: the processor code fingerprint' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: runs,
};
