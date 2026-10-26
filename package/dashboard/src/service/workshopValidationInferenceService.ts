import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { WorkshopDocument, Workflow, WorkshopNode } from '../models/workshopInferencemodel';
export function invalid(message: string): never {
  throw new ApplicationError('invalid_input', message);
}
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
export const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (v: unknown, n = 1000): v is string =>
  typeof v === 'string' && v.length <= n && !/[\u0000-\u001f]/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const time = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v);
const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
/** Recorded days that move with each run, in days from the run's UTC date. */
export const relativeDays: Record<string, number> = { 'run-day': 0, 'previous-day': -1 };
export const isRelativeDay = (day: unknown) => typeof day === 'string' && Object.hasOwn(relativeDays, day);
// ponytail: fixed margin for the relay to upload a window's last clips; raise it if uploads lag.
export const uploadGraceMinutes = 10;
export const noMedia = 'The selected input has no available media.';
export function validateDocument(value: unknown): WorkshopDocument {
  if (
    !record(value) ||
    value.version !== 3 ||
    !Array.isArray(value.buckets) ||
    !Array.isArray(value.workflows) ||
    value.buckets.length > 500 ||
    value.workflows.length > 100
  )
    invalid('Invalid Workshop document.');
  const v = value as unknown as WorkshopDocument,
    bucketIds = new Set<string>(),
    names = new Set<string>();
  for (const b of v.buckets) {
    if (
      !record(b) ||
      !identifier(b.id) ||
      bucketIds.has(b.id) ||
      !text(b.name, 100) ||
      !b.name.trim() ||
      names.has(b.name.trim().toLowerCase()) ||
      !text(b.description, 300) ||
      !['raw', 'labeled'].includes(b.kind)
    )
      invalid('Invalid or duplicate bucket.');
    if (
      b.kind === 'raw'
        ? b.id !== 'camera-archive' || b.createdAt !== null
        : !text(b.createdAt) || !Number.isFinite(Date.parse(b.createdAt))
    )
      invalid('Invalid bucket provenance.');
    bucketIds.add(b.id);
    names.add(b.name.trim().toLowerCase());
  }
  if (!v.buckets.some(b => b.id === 'camera-archive' && b.kind === 'raw')) invalid('The camera archive is required.');
  const wfIds = new Set<string>();
  for (const w of v.workflows) {
    if (
      !record(w) ||
      !identifier(w.id) ||
      wfIds.has(w.id) ||
      !text(w.name, 100) ||
      !text(w.updatedAt) ||
      !Array.isArray(w.nodes) ||
      !Array.isArray(w.edges) ||
      w.nodes.length > 100 ||
      w.edges.length > 300
    )
      invalid('Invalid workflow.');
    wfIds.add(w.id);
    const ids = new Set<string>();
    for (const n of w.nodes) {
      if (
        !record(n) ||
        !identifier(n.id) ||
        ids.has(n.id) ||
        n.type !== 'workshop' ||
        !record(n.position) ||
        !finite(n.position.x) ||
        !finite(n.position.y) ||
        !record(n.data) ||
        !text(n.data.label)
      )
        invalid('Invalid workflow node.');
      ids.add(n.id);
      const d = n.data;
      switch (d.kind) {
        case 'input':
          if (!text(d.camera, 64) || (d.bucketId !== '' && !bucketIds.has(String(d.bucketId))))
            invalid('Invalid input bucket.');
          if (d.includeRejected !== undefined && typeof d.includeRejected !== 'boolean')
            invalid('includeRejected must be true or false.');
          break;
        case 'output':
          if (d.bucketId !== '' && !v.buckets.some(b => b.id === d.bucketId && b.kind === 'labeled'))
            invalid('Choose a labeled output bucket.');
          break;
        case 'footage':
          if (
            (!text(d.day, 10) && !isRelativeDay(d.day)) ||
            !text(d.from, 8) ||
            !text(d.until, 8) ||
            !finite(d.interval) ||
            d.interval < 1 ||
            d.interval > 3600 ||
            (d.pick !== undefined && !['first', 'change'].includes(String(d.pick)))
          )
            invalid('Invalid frame sampling.');
          break;
        case 'model':
          if (!text(d.modelKey, 150) || !finite(d.score) || d.score < 0 || d.score > 1)
            invalid('Invalid model settings.');
          break;
        case 'condition':
          validateCondition(d);
          break;
        case 'nothing':
          break;
        case 'schedule':
          if (
            !['time', 'arrival', 'workflow'].includes(String(d.trigger)) ||
            !Array.isArray(d.days) ||
            d.days.some(x => !Number.isInteger(x) || x < 0 || x > 6) ||
            !text(d.at, 5) ||
            !text(d.workflowId, 80) ||
            typeof d.onlyIf !== 'boolean'
          )
            invalid('Invalid schedule.');
          break;
        default:
          invalid('Unknown workflow step.');
      }
    }
    const edgeIds = new Set<string>();
    for (const e of w.edges) {
      if (
        !record(e) ||
        !identifier(e.id) ||
        edgeIds.has(e.id) ||
        !ids.has(e.source) ||
        !ids.has(e.target) ||
        !['out', 'yes', 'no'].includes(e.sourceHandle) ||
        e.targetHandle !== 'in'
      )
        invalid('Invalid connection.');
      edgeIds.add(e.id);
    }
  }
  // A workflow that starts after another must never lead back to itself.
  const follows = new Map<string, string[]>();
  for (const w of v.workflows)
    follows.set(
      w.id,
      w.nodes
        .filter(n => n.data.kind === 'schedule' && n.data.trigger === 'workflow')
        .map(n => String(n.data.workflowId)),
    );
  const settled = new Set<string>(),
    path = new Set<string>();
  const visit = (id: string) => {
    if (path.has(id)) invalid('Scheduled workflows cannot start each other in a loop.');
    if (settled.has(id)) return;
    path.add(id);
    (follows.get(id) ?? []).forEach(visit);
    path.delete(id);
    settled.add(id);
  };
  v.workflows.forEach(w => visit(w.id));
  return v;
}
function validateCondition(d: Record<string, unknown>, complete = false) {
  if (!['all', 'any'].includes(String(d.match)) || !Array.isArray(d.rules) || !d.rules.length || d.rules.length > 8)
    invalid('Choose 1–8 condition rules.');
  for (const r of d.rules as unknown[]) {
    if (!record(r) || !text(r.id, 150) || !r.id) invalid('Invalid condition rule.');
    if (r.kind === 'time' || r.kind === 'weekday') {
      if (!text(r.timeZone, 100)) invalid('Choose a time zone.');
      if (complete)
        try {
          new Intl.DateTimeFormat('en', { timeZone: r.timeZone as string });
        } catch {
          invalid('Unknown time zone.');
        }
      if (
        r.kind === 'time'
          ? complete
            ? !time(r.from) || !time(r.until) || r.from === r.until
            : !text(r.from, 8) || !text(r.until, 8)
          : !Array.isArray(r.days) ||
            (complete && !r.days.length) ||
            r.days.some(x => !Number.isInteger(x) || x < 0 || x > 6)
      )
        invalid('Invalid time condition.');
    } else {
      if (!text(r.className, 100)) invalid('Invalid class filter.');
      if (r.kind === 'class') {
        if (!['present', 'absent'].includes(String(r.operator))) invalid('Invalid class condition.');
      } else if (r.kind === 'confidence') {
        if (
          !['at-least', 'below'].includes(String(r.operator)) ||
          !finite(r.threshold) ||
          r.threshold < 0 ||
          r.threshold > 1
        )
          invalid('Invalid confidence condition.');
      } else if (r.kind === 'count') {
        if (
          !['at-least', 'equal', 'at-most'].includes(String(r.operator)) ||
          !Number.isInteger(r.count) ||
          Number(r.count) < 0 ||
          Number(r.count) > 10000
        )
          invalid('Invalid count condition.');
      } else if (r.kind === 'motion') {
        if (!motions.includes(String(r.operator))) invalid('Invalid motion condition.');
      } else invalid('Unsupported condition.');
    }
  }
}
const motions = ['moving', 'stationary', 'brief'];
/** Whether a workflow needs a processor that tracks objects: it keeps frames by change or routes on motion. */
export const usesTracking = (w: Workflow) =>
  w.nodes.some(
    n =>
      (n.data.kind === 'footage' && n.data.pick === 'change') ||
      (n.data.kind === 'condition' &&
        Array.isArray(n.data.rules) &&
        n.data.rules.some(r => record(r) && r.kind === 'motion')),
  );
/** Server execution validation: drafts can be disconnected; submitted runs cannot. */
export function executionGraph(w: Workflow) {
  const inputs = w.nodes.filter(n => n.data.kind === 'input'),
    outputs = w.nodes.filter(n => n.data.kind === 'output');
  if (inputs.length !== 1 || !outputs.length) invalid('Connect one input bucket and at least one output bucket.');
  if ([...inputs, ...outputs].some(n => !n.data.bucketId))
    invalid('Choose a replacement for each missing input or output bucket before running.');
  if (outputs.some(n => n.data.bucketId === inputs[0].data.bucketId))
    invalid('A run cannot write into its input bucket.');
  const map = new Map(w.nodes.map(n => [n.id, n]));
  const schedules = w.nodes.filter(n => n.data.kind === 'schedule');
  if (schedules.length > 1) invalid('Use one schedule per workflow.');
  for (const s of schedules)
    if (
      w.edges.some(e => e.target === s.id) ||
      w.edges.filter(e => e.source === s.id).length !== 1 ||
      !w.edges.some(e => e.source === s.id && e.sourceHandle === 'out' && e.target === inputs[0].id)
    )
      invalid('Connect the schedule to the input bucket.');
  const visited = new Set<string>(),
    active = new Set<string>();
  function walk(n: WorkshopNode, kind: 'video' | 'frames' | 'labels', hasModel = false) {
    if (active.has(n.id)) invalid('Workflow connections contain a cycle.');
    active.add(n.id);
    visited.add(n.id);
    const d = n.data;
    if (d.kind === 'condition') validateCondition(d, true);
    if (d.kind === 'footage') {
      if (kind !== 'video') invalid('Frame sampling requires video.');
      kind = 'frames';
    }
    if (d.kind === 'model') {
      if (kind === 'video') invalid('Add frame sampling before a model.');
      kind = 'labels';
      hasModel = true;
    }
    if (
      d.kind === 'condition' &&
      (d.rules as Record<string, unknown>[]).some(r =>
        ['class', 'confidence', 'count', 'motion'].includes(String(r.kind)),
      ) &&
      kind !== 'labels'
    )
      invalid('Prediction conditions need an upstream model.');
    if (d.kind === 'output' && (kind !== 'labels' || !hasModel))
      invalid('Every output path needs a model in this run. Add a model before the output bucket.');
    const edges = w.edges.filter(e => e.source === n.id),
      incoming = w.edges.filter(e => e.target === n.id);
    if (
      d.kind === 'input'
        ? incoming.length !== schedules.length
        : d.kind === 'output' || d.kind === 'nothing'
          ? incoming.length < 1
          : incoming.length !== 1
    )
      invalid('Each processing step needs exactly one incoming connection.');
    const required =
      d.kind === 'output' || d.kind === 'nothing' ? [] : d.kind === 'condition' ? ['yes', 'no'] : ['out'];
    if (edges.length !== required.length || required.some(h => edges.filter(e => e.sourceHandle === h).length !== 1))
      invalid('Connect every output port.');
    for (const e of edges) walk(map.get(e.target)!, kind, hasModel);
    active.delete(n.id);
  }
  // An output may receive both mutually exclusive branches. Its incoming count is checked separately below.
  const raw = inputs[0].data.bucketId === 'camera-archive';
  walk(inputs[0], raw ? 'video' : 'labels');
  if (visited.size + schedules.length !== w.nodes.length) invalid('Connect or remove unused steps before running.');
  const footage = w.nodes.filter(n => n.data.kind === 'footage');
  if (raw ? footage.length !== 1 : footage.length !== 0)
    invalid('Raw inputs need one frame sampling step. Labeled inputs already contain images.');
  const schedule = schedules[0];
  if (schedule) validateSchedule(schedule.data, footage[0]?.data);
  return { input: inputs[0], outputs, footage: footage[0], schedule };
}
function validateSchedule(d: Record<string, unknown>, footage?: Record<string, unknown>) {
  if (footage?.day && !isRelativeDay(footage.day))
    invalid(
      'A scheduled workflow would process the same recorded day every time. Choose Day of each run or Day before each run in the footage filter.',
    );
  if (d.trigger === 'time') {
    if (!(d.days as number[]).length || !time(d.at)) invalid('Choose the days and UTC time for this schedule.');
    if (
      footage?.day === 'run-day' &&
      time(footage.until) &&
      minutes(d.at) < minutes(footage.until) + uploadGraceMinutes
    ) {
      const earliest = minutes(footage.until) + uploadGraceMinutes;
      invalid(
        earliest >= 1440
          ? 'This window ends too late in the day to finish uploading before midnight UTC. Use Day before each run.'
          : `Schedule at ${String(Math.floor(earliest / 60)).padStart(2, '0')}:${String(earliest % 60).padStart(2, '0')} UTC or later so the whole window has been recorded and uploaded.`,
      );
    }
  }
  if (d.trigger === 'workflow' && !identifier(d.workflowId)) invalid('Choose the workflow this one follows.');
}
export function resolveDay(day: unknown, now: Date) {
  return isRelativeDay(day) ? new Date(+now + relativeDays[day as string] * 86400000).toISOString().slice(0, 10) : day;
}
export function samplingWindow(raw: Record<string, unknown>, now = new Date()) {
  const data: Record<string, unknown> = { ...raw, day: resolveDay(raw.day, now) };
  if (!text(data.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(data.day) || !time(data.from) || !time(data.until))
    invalid('Choose a recorded date and time range.');
  const from = new Date(`${data.day}T${data.from}Z`),
    until = new Date(`${data.day}T${data.until}Z`);
  if (
    !Number.isFinite(+from) ||
    !Number.isFinite(+until) ||
    from >= until ||
    from.toISOString().slice(0, 10) !== data.day
  )
    invalid('Invalid recorded window.');
  return { from: from.toISOString(), until: until.toISOString() };
}
