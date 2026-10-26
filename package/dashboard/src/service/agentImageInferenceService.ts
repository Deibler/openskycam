import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { Env, MachineApp } from '../models/applicationSharedmodel';
import type { AgentContent, AgentTool } from '../models/agentSharedmodel';
import type { WorkshopItem } from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import * as runOps from '../db/WorkshopRunInferenceOps';
import { agentPreview } from '../db/ImageSharedOps';
import { action, detections, ids, number, reply, text } from '../utils/agentSharedUtil';
import { requireApiCamera, signLinks } from './credentialSharedService';
import { readImage, saveItem } from './workshopInferenceService';
import { reviewItem } from './workshopReviewInferenceService';
import { previewImage } from './workshopRunInferenceService';

const actions = ['search', 'view', 'review', 'save', 'link'] as const;
const now = () => new Date().toISOString();

/**
 * A downscaled JPEG an agent can look at. Claude Code caps each tool result at ~25k tokens,
 * so full frames are never inlined; the full-size file is always a link.
 */
export async function agentView(
  env: Env,
  body: ReadableStream<Uint8Array>,
  size: number,
  crop?: { left: number; top: number; width: number; height: number },
): Promise<AgentContent | null> {
  try {
    return { type: 'image', data: await agentPreview(env, body, size, crop), mimeType: 'image/jpeg' };
  } catch (error) {
    console.warn('Agent image preview failed', error);
    return null;
  }
}

function summary(i: WorkshopItem) {
  return {
    image_id: i.id,
    bucket_id: i.bucket_id,
    run_id: i.run_id,
    camera: i.cam,
    captured_at: i.captured_at,
    review: i.review,
    saved: i.object_key.startsWith('retained/'),
    expires_at: i.expires_at,
    detections: detections(i.annotation_json),
  };
}

/** Saved images, or a test run's temporary previews when run_id is given. Only the key's cameras. */
async function load(app: MachineApp, args: JsonObject, max: number) {
  const wanted = ids(args, 'image_ids', max),
    run = text(args, 'run_id');
  const found = run
    ? (await Promise.all(wanted.map(id => runOps.preview(app.env, run, id, now())))).flatMap(row =>
        row ? [JSON.parse(row.item_json) as WorkshopItem] : [],
      )
    : await ops.itemsByIds(app.env, wanted, now());
  const missing = wanted.filter(id => !found.some(i => i.id === id));
  if (missing.length)
    throw new ApplicationError(
      'not_found',
      `Not found or expired: ${missing.join(', ')}.${run ? '' : ' Test-run previews need run_id.'}`,
    );
  for (const item of found) requireApiCamera(app.principal, item.cam);
  return { items: wanted.map(id => found.find(i => i.id === id)!), run };
}

async function search(app: MachineApp, args: JsonObject) {
  const cam = text(args, 'camera'),
    limit = number(args, 'limit', 1, 100, 20),
    offset = number(args, 'offset', 0, 100000, 0);
  const review = text(args, 'status') ?? null;
  if (review && !['pending', 'accepted', 'rejected'].includes(review))
    throw new ApplicationError('invalid_input', 'status must be pending, accepted, or rejected.');
  const rows = await ops.searchItems(
    app.env,
    {
      cameras: cam ? [requireApiCamera(app.principal, cam)] : app.principal.cameras,
      bucket: text(args, 'bucket_id') ?? null,
      run: text(args, 'run_id') ?? null,
      review,
      from: text(args, 'from') ?? null,
      to: text(args, 'to') ?? null,
      className: text(args, 'class') ?? null,
      minConfidence: args.min_confidence === undefined ? null : number(args, 'min_confidence', 0, 1),
      limit: limit + 1,
      offset,
    },
    now(),
  );
  const more = rows.length > limit;
  return reply(
    { images: rows.slice(0, limit).map(summary), next_offset: more ? offset + limit : null },
    rows.length
      ? "images view shows them; a detection's box can be passed as crop to zoom in."
      : 'Nothing matched. Loosen a filter, or check buckets list for image counts.',
  );
}

async function view(app: MachineApp, args: JsonObject) {
  const { items, run } = await load(app, args, 4);
  const size = number(args, 'size', 128, 1600, 768);
  const box = args.crop;
  if (
    box !== undefined &&
    (!Array.isArray(box) ||
      box.length !== 4 ||
      box.some(n => typeof n !== 'number' || n < 0 || n > 1) ||
      box[0] >= box[2] ||
      box[1] >= box[3])
  )
    throw new ApplicationError(
      'invalid_input',
      'crop is a normalized [x1, y1, x2, y2] box, each 0–1, like a detection box.',
    );
  const content: AgentContent[] = [];
  for (const item of items) {
    const p = JSON.parse(item.provenance_json) as { width: number; height: number };
    const [x1, y1, x2, y2] = (box as number[] | undefined) ?? [0, 0, 1, 1];
    const crop = box
      ? {
          left: Math.floor(x1 * p.width),
          top: Math.floor(y1 * p.height),
          width: Math.max(1, Math.ceil((x2 - x1) * p.width)),
          height: Math.max(1, Math.ceil((y2 - y1) * p.height)),
        }
      : undefined;
    const object = run ? await previewImage(app.env, run, item.id) : await readImage(app.env, item.id);
    const image = await agentView(app.env, object.body, size, crop);
    content.push(
      ...reply({
        ...summary(item),
        width: p.width,
        height: p.height,
        ...(crop ? { cropped_to: box } : {}),
        shown: image ? 'below' : 'preview unavailable; use images link',
      }),
    );
    if (image) content.push(image);
  }
  return content;
}

async function review(app: MachineApp, args: JsonObject) {
  const decision = text(args, 'decision', true)!;
  if (!['accepted', 'rejected', 'pending'].includes(decision))
    throw new ApplicationError('invalid_input', 'decision must be accepted, rejected, or pending.');
  const { items } = await load(app, args, 100);
  for (const item of items) await reviewItem(app.env, item.id, { review: decision });
  return reply({ updated: items.length, review: decision }, 'Verify with images search status=' + decision + '.');
}

async function save(app: MachineApp, args: JsonObject) {
  const { items } = await load(app, args, 20);
  for (const item of items) await saveItem(app.env, item.id);
  return reply({
    saved: items.map(i => i.id),
    note: 'Saved images, labels, and provenance no longer expire. The source video keeps its own lifetime.',
  });
}

async function link(app: MachineApp, args: JsonObject) {
  const { items, run } = await load(app, args, 100);
  const links = await signLinks(
    app.env,
    app.principal,
    items.map(i => (run ? `/v1/workshop/runs/${run}/previews/${i.id}/image` : `/v1/workshop/items/${i.id}/image`)),
  );
  return reply(
    {
      images: items.map((i, n) => ({
        image_id: i.id,
        url: links[n].url,
        filename: `${i.cam}_${i.captured_at.replace(/[-:.]/g, '')}.jpg`,
      })),
      links_expire_at: links[0].expires_at,
    },
    'Save each with: curl -fL -o <filename> "<url>"',
  );
}

async function images(app: MachineApp, args: JsonObject) {
  switch (action(args, actions)) {
    case 'search':
      return search(app, args);
    case 'view':
      return view(app, args);
    case 'review':
      return review(app, args);
    case 'save':
      return save(app, args);
    default:
      return link(app, args);
  }
}

export const imagesTool: AgentTool = {
  name: 'images',
  title: 'Detection images',
  description:
    'Frames that workflow runs saved into buckets, with their model detections. Actions: search (filter by bucket_id, run_id, class, min_confidence, status, camera, from/to; newest first); view (show up to 4 images, optionally cropped to a normalized box); review (set accepted/rejected/pending on up to 100); save (keep up to 20 images past their expiry); link (full-size download links). Test-run previews are temporary: pass their run_id. Read guide images first.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...actions] },
      image_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'view/review/save/link: image IDs from search or a run',
      },
      run_id: { type: 'string', description: "search: only this run. view/link: required for a test run's previews" },
      bucket_id: { type: 'string', description: 'search: only this bucket (see buckets list)' },
      class: { type: 'string', description: 'search: a detected class name, case-insensitive' },
      min_confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'search: at least one detection this confident (with class, of that class)',
      },
      status: { type: 'string', enum: ['pending', 'accepted', 'rejected'], description: 'search: review status' },
      camera: { type: 'string' },
      from: { type: 'string', description: 'search: captured at or after (UTC ISO 8601)' },
      to: { type: 'string', description: 'search: captured before' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'search: page size (default 20)' },
      offset: { type: 'integer', minimum: 0, description: 'search: next_offset from the previous page' },
      decision: { type: 'string', enum: ['accepted', 'rejected', 'pending'], description: 'review: the new status' },
      crop: {
        type: 'array',
        items: { type: 'number' },
        minItems: 4,
        maxItems: 4,
        description: 'view: [x1, y1, x2, y2] normalized, e.g. a detection box, to zoom in',
      },
      size: {
        type: 'integer',
        minimum: 128,
        maximum: 1600,
        description: 'view: longest side shown to you (default 768)',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: images,
};
