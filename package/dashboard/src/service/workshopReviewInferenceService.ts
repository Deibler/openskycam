import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { Env } from '../models/applicationSharedmodel';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type {
  WorkshopAnnotation,
  WorkshopInput,
  WorkshopItem,
  WorkshopRecording,
  WorkshopRunReview,
  WorkshopSnapshot,
  WorkshopSummary,
} from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import * as reviewOps from '../db/WorkshopReviewInferenceOps';
import { recordingOf } from '../utils/recordingInferenceUtil';
import { canonicalModel } from '../utils/modelInferenceUtil';
import { photoWorkflowId } from './workshopInferenceService';
import { invalid, record } from './workshopValidationInferenceService';

const now = () => new Date().toISOString();
const reviewLimit = 1000;

export async function workshopSummary(env: Env): Promise<WorkshopSummary> {
  const at = now();
  const [buckets, items, runs, latest, classes, daily] = await Promise.all([
    ops.bucketCounts(env, at),
    reviewOps.workflowItems(env, at),
    reviewOps.workflowRuns(env, photoWorkflowId),
    ops.listRuns(env, photoWorkflowId, at, { latest: true, limit: 1000 }),
    reviewOps.classStats(env, at),
    reviewOps.dailyStats(env, at),
  ]);
  const ids = new Set([...runs, ...items].map(row => row.workflow_id));
  return {
    buckets,
    workflows: [...ids].map(id => {
      const counts = items.find(row => row.workflow_id === id);
      return {
        workflow_id: id,
        runs: runs.find(row => row.workflow_id === id)?.runs ?? 0,
        last_run: latest.find(row => row.workflow_id === id) ?? null,
        images: counts?.images ?? 0,
        accepted: counts?.accepted ?? 0,
        rejected: counts?.rejected ?? 0,
        pending: counts?.pending ?? 0,
        classes: classes.filter(row => row.workflow_id === id).map(({ workflow_id, ...row }) => row),
        daily: daily.filter(row => row.workflow_id === id).map(({ workflow_id, ...row }) => row),
      };
    }),
  };
}

export async function runReview(env: Env, id: string): Promise<WorkshopRunReview> {
  const run = await ops.run(env, id);
  if (!run || run.workflow_id === photoWorkflowId) throw new ApplicationError('not_found', 'Run not found.');
  const snapshot = JSON.parse(run.snapshot_json) as WorkshopSnapshot;
  const [items, inputs] = await Promise.all([
    reviewOps.runItems(env, id, now(), reviewLimit + 1),
    reviewOps.runInputs(env, id),
  ]);
  // Expired inputs are cleared to '{}', so the frames' own provenance fills in their recordings.
  const recordings = new Map<string, WorkshopRecording>();
  const sources = [
    ...inputs.map(({ input_json }) => {
      const input = JSON.parse(input_json) as Partial<WorkshopInput>;
      return input.recording ?? (input.item ? JSON.parse(input.item.provenance_json) : null);
    }),
    ...items.map(item => JSON.parse(item.provenance_json)),
  ];
  for (const source of sources) {
    const recording = recordingOf(source);
    if (recording) recordings.set(`${recording.cam}/${recording.start}`, recording);
  }
  return {
    run: {
      id: run.id,
      name: run.name,
      workflow_id: run.workflow_id,
      mode: snapshot.mode === 'test' ? 'test' : 'run',
      created_at: run.created_at,
      output_buckets: snapshot.output_buckets,
    },
    recordings: [...recordings.values()].sort((a, b) => a.start.localeCompare(b.start)),
    classes: snapshot.models.map(m => ({
      node_id: m.node_id,
      classes: m.model.classes.map(c => ({ id: c.id, name: c.name })),
    })),
    items: items.slice(0, reviewLimit).map(item => ({ ...item, image_url: `/api/workshop/items/${item.id}/image` })),
    has_more: items.length > reviewLimit,
  };
}

const sameBox = (a?: number[], b?: number[]) => (!a && !b) || (!!a && !!b && a.every((n, i) => n === b[i]));
const overlap = (a: number[], b: number[]) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]),
    h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]),
    shared = Math.max(0, w) * Math.max(0, h);
  return shared / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - shared);
};
/** The track of the model box a reviewer's box came from: the same box, else the one it overlaps most (by half). */
function trackOf(original: WorkshopAnnotation[], box: number[]) {
  const tracked = original.filter(o => o.track_id && o.box);
  const same = tracked.find(o => sameBox(o.box, box));
  if (same) return same.track_id;
  const best = tracked.reduce<[number, string | undefined]>(
    (top, o) => (overlap(o.box!, box) > top[0] ? [overlap(o.box!, box), o.track_id] : top),
    [0.5, undefined],
  );
  return best[1];
}
/** A reviewer's labels, limited to the classes of the model that labeled the image. */
function editedLabels(item: WorkshopItem, value: unknown): WorkshopAnnotation[] {
  const model = JSON.parse(item.provenance_json).annotation_model as {
    classes: { id: number; name: string }[];
    task: string;
    node_id: string;
  } | null;
  if (!model) invalid('This image has no model labels to edit.');
  if (!Array.isArray(value) || value.length > 100) invalid('Provide up to 100 labels.');
  const original = JSON.parse(item.annotation_json) as WorkshopAnnotation[];
  const detection = model.task === 'object-detection';
  return value.map(label => {
    if (!record(label)) invalid('Each label must be an object.');
    const choice = model.classes.find(c => c.name === label.class_name);
    if (!choice) invalid(`Choose one of the model's classes: ${model.classes.map(c => c.name).join(', ')}.`);
    const box = label.box;
    if (
      detection &&
      !(
        Array.isArray(box) &&
        box.length === 4 &&
        box.every(n => typeof n === 'number' && n >= 0 && n <= 1) &&
        box[0] < box[2] &&
        box[1] < box[3]
      )
    )
      invalid('Each detection needs a box of four fractions: left, top, right, bottom.');
    if (typeof label.confidence !== 'number' || !(label.confidence >= 0 && label.confidence <= 1))
      invalid('Each label needs a confidence between 0 and 1.');
    const kept = detection ? { box: box as number[] } : {};
    const edited = !original.some(o => o.class_name === choice.name && sameBox(o.box, kept.box));
    // A relabelled or adjusted box is still the same object, so it keeps its trajectory.
    const track = kept.box && trackOf(original, kept.box);
    return {
      class_id: choice.id,
      class_name: choice.name,
      confidence: label.confidence,
      ...kept,
      model_node: model.node_id,
      ...(edited ? { edited: true } : {}),
      ...(track ? { track_id: track } : {}),
    };
  });
}

export async function reviewItem(env: Env, id: string, body: JsonObject) {
  if (!['pending', 'accepted', 'rejected'].includes(String(body.review)))
    invalid('Choose an accepted, rejected, or pending review.');
  let labels: WorkshopAnnotation[] | null = null;
  if (body.annotations !== undefined) {
    const item = await ops.item(env, id, now());
    if (!item) throw new ApplicationError('not_found', 'Image expired or missing.');
    labels = editedLabels(item, body.annotations);
  }
  if (!(await ops.review(env, id, String(body.review), now(), labels && canonicalModel(labels))))
    throw new ApplicationError('not_found', 'Image expired or missing.');
  return { review: body.review, ...(labels ? { annotations: labels } : {}) };
}
