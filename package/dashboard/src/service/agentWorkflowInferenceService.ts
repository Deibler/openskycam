import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { MachineApp } from '../models/applicationSharedmodel';
import type { AgentStep, AgentTool } from '../models/agentSharedmodel';
import type { ModelVersion } from '../models/modelInferencemodel';
import type {
  Bucket,
  Workflow,
  WorkshopDocument,
  WorkshopEdge,
  WorkshopNode,
  WorkshopState,
} from '../models/workshopInferencemodel';
import * as ops from '../db/WorkshopInferenceOps';
import { findModel } from '../db/ModelInferenceOps';
import { action, place, reply, text } from '../utils/agentSharedUtil';
import { requireApiCamera, signLinks } from './credentialSharedService';
import { RETENTION_MS } from '../../../shared/src/utils/layoutStorageUtil';
import { createVersion, loadWorkshop, readVersion, saveWorkshop, workshopModelIssue } from './workshopInferenceService';
import { deleteWorkshopEntry, previewDeletion } from './workshopDeletionInferenceService';
import { executionGraph, identifier, invalid, record, samplingWindow } from './workshopValidationInferenceService';

/** Every step kind with its settings and the defaults the website uses for a new step. */
const kinds: Record<string, Record<string, unknown>> = {
  schedule: { label: 'Schedule', trigger: 'time', days: [0, 1, 2, 3, 4, 5, 6], at: '', workflowId: '', onlyIf: false },
  input: { label: 'Input bucket', bucketId: 'camera-archive', camera: '', includeRejected: false },
  footage: { label: 'Choose footage', day: '', from: '', until: '', interval: 5, pick: 'first' },
  model: { label: 'Run a model', modelKey: '', score: 0.5 },
  condition: { label: 'Condition', match: 'all', rules: [] },
  nothing: { label: 'Do nothing' },
  output: { label: 'Output bucket', bucketId: '' },
};
const now = () => new Date().toISOString();

export function compact(w: Workflow) {
  return {
    workflow_id: w.id,
    name: w.name,
    updated_at: w.updatedAt,
    steps: w.nodes.map(n => ({ id: n.id, ...n.data }) as AgentStep),
    links: w.edges.map(e => ({ from: e.source, to: e.target, port: e.sourceHandle })),
  };
}

/** Steps an agent sends become nodes. Omitted settings keep their current (or default) values. */
function toNodes(doc: WorkshopDocument, previous: Workflow | undefined, value: unknown): WorkshopNode[] {
  if (value === undefined) return previous!.nodes;
  if (!Array.isArray(value) || !value.length || value.length > 100) invalid('steps must list 1 to 100 steps.');
  const seen = new Set<string>();
  return value.map((raw, i) => {
    if (!record(raw)) invalid(`steps[${i}] must be an object.`);
    const kind = String(raw.kind),
      base = kinds[kind];
    if (!base) invalid(`steps[${i}].kind must be one of: ${Object.keys(kinds).join(', ')}.`);
    const extra = Object.keys(raw).filter(k => !['id', 'kind', ...Object.keys(base)].includes(k));
    if (extra.length)
      invalid(`steps[${i}] (${kind}) has no setting ${extra.join(', ')}. It takes: ${Object.keys(base).join(', ')}.`);
    const id = raw.id ?? crypto.randomUUID();
    if (!identifier(id) || seen.has(id)) invalid(`steps[${i}].id must be unique: letters, digits, - and _.`);
    seen.add(id);
    const before = previous?.nodes.find(n => n.id === id && n.data.kind === kind);
    const { id: _, ...given } = raw;
    const data: Record<string, unknown> = { ...base, ...before?.data, ...given, kind };
    if ('bucketId' in data) data.bucketId = bucketRef(doc, data.bucketId);
    if (Array.isArray(data.rules))
      data.rules = data.rules.map((r, n) => (record(r) && !r.id ? { ...r, id: `rule-${n + 1}` } : r));
    return {
      ...(before ?? { deletable: kind !== 'input' && kind !== 'output' }),
      id,
      type: 'workshop',
      position: before?.position ?? { x: NaN, y: NaN },
      data,
    } as WorkshopNode;
  });
}

/** Buckets may be named instead of referenced by ID. */
function bucketRef(doc: WorkshopDocument, value: unknown) {
  if (typeof value !== 'string' || !value || doc.buckets.some(b => b.id === value)) return value;
  const named = doc.buckets.filter(b => b.name.toLowerCase() === value.trim().toLowerCase());
  if (named.length !== 1) invalid(`No bucket ${value}. buckets list shows them; buckets create makes one.`);
  return named[0].id;
}

function toEdges(previous: Workflow | undefined, nodes: WorkshopNode[], value: unknown): WorkshopEdge[] {
  const exists = (id: unknown) => nodes.some(n => n.id === id);
  if (value === undefined) return (previous?.edges ?? []).filter(e => exists(e.source) && exists(e.target));
  if (!Array.isArray(value) || value.length > 300) invalid('links must list at most 300 connections.');
  return value.map((raw, i) => {
    if (!record(raw) || !exists(raw.from) || !exists(raw.to))
      invalid(`links[${i}] needs from and to set to IDs in steps.`);
    const port = String(raw.port ?? 'out');
    if (!['out', 'yes', 'no'].includes(port)) invalid(`links[${i}].port must be out, or yes/no from a condition.`);
    return (
      previous?.edges.find(e => e.source === raw.from && e.target === raw.to && e.sourceHandle === port) ??
      ({
        id: crypto.randomUUID(),
        source: String(raw.from),
        target: String(raw.to),
        sourceHandle: port,
        targetHandle: 'in',
        type: 'default',
        ...(port === 'yes' ? { label: 'Then' } : port === 'no' ? { label: 'Otherwise' } : {}),
      } as WorkshopEdge)
    );
  });
}

/** New steps are placed left to right by distance from the input, so the website canvas stays readable. */
/** Whether a run could start now, and the first reason it could not. */
async function readiness(app: MachineApp, w: Workflow) {
  try {
    const { input, footage } = executionGraph(w);
    if (input.data.bucketId === 'camera-archive') requireApiCamera(app.principal, String(input.data.camera ?? ''));
    for (const n of w.nodes.filter(n => n.data.kind === 'model')) {
      const [family, version, ...rest] = String(n.data.modelKey).split('/');
      const row = !rest.length && family && version ? await findModel(app.env, family, version) : null;
      if (!row) return { ready: false, issue: `Step ${n.id}: choose a modelKey from models list.` };
      const issue = workshopModelIssue(JSON.parse(row.manifest_json) as ModelVersion);
      if (issue) return { ready: false, issue: `Step ${n.id}: ${issue}` };
    }
    if (footage) samplingWindow(footage.data);
    return { ready: true, issue: null };
  } catch (error) {
    if (error instanceof ApplicationError) return { ready: false, issue: error.message };
    throw error;
  }
}

/** Clips and sampled images the footage window holds for a run started now. */
async function estimate(app: MachineApp, w: Workflow) {
  const input = w.nodes.find(n => n.data.kind === 'input')?.data,
    footage = w.nodes.find(n => n.data.kind === 'footage')?.data;
  if (input?.bucketId !== 'camera-archive' || !footage) return null;
  const { from, until } = samplingWindow(footage, new Date());
  const rows = await ops.recordings(
    app.env,
    String(input.camera),
    from,
    until,
    new Date(Date.now() - RETENTION_MS).toISOString(),
  );
  const images = rows.reduce((sum, r) => {
    const start = Math.max(Date.parse(r.start), Date.parse(from)),
      end = Math.min(Date.parse(r.start) + (r.duration_s ?? 0) * 1000, Date.parse(until));
    return sum + Math.max(0, Math.floor((end - start) / 1000 / Number(footage.interval)));
  }, 0);
  return {
    from,
    until,
    clips: rows.length > 100 ? 'over 100 (a run takes at most 100)' : rows.length,
    estimated_images: images,
  };
}

async function state(app: MachineApp, args: JsonObject, required: boolean) {
  const current = await loadWorkshop(app.env);
  if (required && args.revision !== current.revision)
    throw new ApplicationError(
      'conflict',
      `Pass revision ${current.revision}. Workshop may have changed since you read it: read it again and reapply your change.`,
    );
  return current;
}
const findWorkflow = (s: WorkshopState, id: string | undefined) =>
  s.document.workflows.find(w => w.id === id) ?? invalid('Workflow not found. workflows list shows their IDs.');
const findBucket = (s: WorkshopState, id: string | undefined) =>
  s.document.buckets.find(b => b.id === id) ?? invalid('Bucket not found. buckets list shows their IDs.');

async function remove(app: MachineApp, args: JsonObject, kind: 'workflow' | 'bucket', id: string) {
  if (args.confirm !== true) {
    const preview = await previewDeletion(app.env, kind, id);
    return reply(
      { would_delete: preview },
      `Tell the user what will be lost. To delete, call again with confirm: true and revision: ${preview.revision}.`,
    );
  }
  const saved = await deleteWorkshopEntry(app.env, kind, id, { revision: args.revision });
  return reply({ deleted: id, revision: saved.revision });
}

async function saveWorkflow(app: MachineApp, s: WorkshopState, workflow: Workflow) {
  place(workflow.nodes, workflow.edges);
  const others = s.document.workflows.filter(w => w.id !== workflow.id);
  const saved = await saveWorkshop(app.env, {
    revision: s.revision,
    document: { ...s.document, workflows: [...others, workflow] },
  });
  const check = await readiness(app, workflow);
  return reply(
    { revision: saved.revision, ...compact(workflow), ...check },
    check.ready
      ? `Saved. Test it with runs test workflow_id=${workflow.id}.`
      : 'Saved as a draft. Fix the issue with workflows update before running.',
  );
}

async function workflows(app: MachineApp, args: JsonObject) {
  switch (action(args, ['list', 'get', 'create', 'update', 'delete', 'check'])) {
    case 'list': {
      const s = await state(app, args, false);
      return reply(
        {
          revision: s.revision,
          workflows: await Promise.all(
            s.document.workflows.map(async w => ({
              workflow_id: w.id,
              name: w.name,
              updated_at: w.updatedAt,
              steps: w.nodes.map(n => `${n.data.kind}: ${n.data.label}`),
              scheduled: w.nodes.some(n => n.data.kind === 'schedule'),
              ...(await readiness(app, w)),
            })),
          ),
        },
        "workflows get shows a workflow's steps and settings.",
      );
    }
    case 'get': {
      const s = await state(app, args, false),
        w = findWorkflow(s, text(args, 'workflow_id', true));
      return reply({ revision: s.revision, ...compact(w), ...(await readiness(app, w)) });
    }
    case 'check': {
      const s = await state(app, args, false),
        w = findWorkflow(s, text(args, 'workflow_id', true));
      return reply({ workflow_id: w.id, ...(await readiness(app, w)), footage: await estimate(app, w) });
    }
    case 'create': {
      const s = await state(app, args, false),
        name = text(args, 'name', true, 100)!.trim();
      const template = [
        { id: 'input', kind: 'input', camera: app.principal.cameras[0] ?? '' },
        { id: 'footage', kind: 'footage' },
        { id: 'model', kind: 'model' },
        { id: 'output', kind: 'output' },
      ];
      const nodes = toNodes(s.document, undefined, args.steps ?? template);
      const links = args.steps
        ? args.links
        : [
            { from: 'input', to: 'footage' },
            { from: 'footage', to: 'model' },
            { from: 'model', to: 'output' },
          ];
      return saveWorkflow(app, s, {
        id: crypto.randomUUID(),
        name,
        updatedAt: now(),
        nodes,
        edges: toEdges(undefined, nodes, links ?? []),
      });
    }
    case 'update': {
      const s = await state(app, args, true),
        before = findWorkflow(s, text(args, 'workflow_id', true));
      const nodes = toNodes(s.document, before, args.steps);
      return saveWorkflow(app, s, {
        ...before,
        name: text(args, 'name', false, 100)?.trim() || before.name,
        updatedAt: now(),
        nodes,
        edges: toEdges(before, nodes, args.links),
      });
    }
    default:
      return remove(app, args, 'workflow', text(args, 'workflow_id', true)!);
  }
}

function bucketName(s: WorkshopState, value: string | undefined, except?: string) {
  const name = value?.trim();
  if (!name || name.length > 100) invalid('A bucket name has 1 to 100 characters.');
  if (s.document.buckets.some(b => b.id !== except && b.name.toLowerCase() === name.toLowerCase()))
    invalid(`A bucket named ${name} already exists.`);
  return name;
}

async function buckets(app: MachineApp, args: JsonObject) {
  switch (action(args, ['list', 'create', 'update', 'delete', 'versions', 'create_version', 'export_version'])) {
    case 'list': {
      const s = await state(app, args, false),
        counts = await ops.bucketCounts(app.env, now());
      return reply(
        {
          revision: s.revision,
          buckets: s.document.buckets.map(b => ({
            bucket_id: b.id,
            name: b.name,
            kind: b.kind,
            description: b.description,
            created_at: b.createdAt,
            ...(b.kind === 'labeled'
              ? (({ bucket_id: _, ...c }) => c)(
                  counts.find(c => c.bucket_id === b.id) ?? {
                    bucket_id: b.id,
                    images: 0,
                    accepted: 0,
                    rejected: 0,
                    pending: 0,
                    saved: 0,
                  },
                )
              : {}),
            used_by: s.document.workflows.filter(w => w.nodes.some(n => n.data.bucketId === b.id)).map(w => w.name),
          })),
        },
        "images search bucket_id=... lists a bucket's images.",
      );
    }
    case 'create': {
      const s = await state(app, args, false);
      const bucket: Bucket = {
        id: crypto.randomUUID(),
        name: bucketName(s, text(args, 'name', true, 100)),
        kind: 'labeled',
        description: (text(args, 'description', false, 300) ?? '').trim(),
        createdAt: now(),
      };
      const saved = await saveWorkshop(app.env, {
        revision: s.revision,
        document: { ...s.document, buckets: [...s.document.buckets, bucket] },
      });
      return reply(
        { revision: saved.revision, bucket_id: bucket.id, name: bucket.name },
        "Use this bucket_id as an output step's bucketId.",
      );
    }
    case 'update': {
      const s = await state(app, args, true),
        b = findBucket(s, text(args, 'bucket_id', true));
      if (b.kind === 'raw') invalid('The camera archive is managed automatically.');
      const next = {
        ...b,
        name: args.name === undefined ? b.name : bucketName(s, text(args, 'name', true, 100), b.id),
        description: (text(args, 'description', false, 300) ?? b.description).trim(),
      };
      const saved = await saveWorkshop(app.env, {
        revision: s.revision,
        document: { ...s.document, buckets: s.document.buckets.map(x => (x.id === b.id ? next : x)) },
      });
      return reply({ revision: saved.revision, bucket_id: b.id, name: next.name, description: next.description });
    }
    case 'delete':
      return remove(app, args, 'bucket', text(args, 'bucket_id', true)!);
    case 'versions': {
      const s = await state(app, args, false),
        b = findBucket(s, text(args, 'bucket_id', true));
      const rows = await ops.versions(app.env, b.id, now());
      return reply({
        bucket_id: b.id,
        versions: rows.map(v => ({
          version_id: v.id,
          name: v.name,
          created_at: v.created_at,
          sha256: v.sha256,
          images: v.images,
        })),
      });
    }
    case 'create_version': {
      const v = await createVersion(app.env, text(args, 'bucket_id', true)!, {
        id: crypto.randomUUID(),
        name: text(args, 'name', true, 100),
        include_rejected: args.include_rejected === true,
      });
      return reply(
        { version_id: v.id, name: v.name, sha256: v.sha256, created_at: v.created_at, images: v.images },
        'buckets export_version gives the manifest link.',
      );
    }
    default: {
      const v = await readVersion(app.env, text(args, 'version_id', true)!);
      for (const item of v.manifest.items) requireApiCamera(app.principal, item.cam);
      const [link] = await signLinks(app.env, app.principal, [`/v1/workshop/versions/${v.id}`]);
      const splits = Object.fromEntries(
        ['train', 'validation', 'test'].map(s => [s, v.manifest.items.filter(i => i.split === s).length]),
      );
      return reply(
        {
          version_id: v.id,
          name: v.name,
          bucket_id: v.bucket_id,
          sha256: v.sha256,
          classes: v.manifest.class_names,
          images: v.manifest.items.length,
          reviews: Object.fromEntries(
            ['accepted', 'rejected'].map(r => [r, v.manifest.items.filter(i => i.review === r).length]),
          ),
          splits,
          manifest: link,
        },
        'The manifest lists every image, label, and split. images link gives download links for its item_ids.',
      );
    }
  }
}

const common = {
  revision: {
    type: 'integer',
    description: 'update/delete: the revision from your last read. Protects edits made on the website.',
  },
  confirm: { type: 'boolean', description: 'delete: true to delete after reviewing the preview' },
  name: { type: 'string' },
};

export const workflowsTool: AgentTool = {
  name: 'workflows',
  title: 'Workflows',
  description:
    'Workshop workflows: an input bucket, a footage window sampled into frames, models, conditions, and output buckets, optionally started by a schedule. Actions: list; get (steps with their settings, and links between them); check (can it run, and how much footage its window holds); create (name, and optional steps/links; without steps you get input → footage → model → output to fill in); update (change name, steps, or links; omitted settings keep their values); delete (preview first, then confirm). Steps are {id, kind, label, ...settings}; links are {from, to, port}. Read guide workflows before editing.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete', 'check'] },
      workflow_id: { type: 'string' },
      ...common,
      steps: {
        type: 'array',
        items: { type: 'object' },
        description:
          'create/update: every step, e.g. {"id":"detect","kind":"model","modelKey":"combined-detector/v2","score":0.4}',
      },
      links: {
        type: 'array',
        items: { type: 'object' },
        description:
          'create/update: every connection, e.g. {"from":"footage","to":"detect"}; conditions use port yes/no',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: workflows,
};

export const bucketsTool: AgentTool = {
  name: 'buckets',
  title: 'Buckets and datasets',
  description:
    'Buckets hold labeled images that workflow runs save; the camera archive is the raw video. Actions: list (with image and review counts); create; update (name/description); delete (preview first, then confirm); versions; create_version (freeze accepted images, and rejected ones with include_rejected, as a train/validation/test dataset); export_version (manifest link). Read guide images first.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'create', 'update', 'delete', 'versions', 'create_version', 'export_version'],
      },
      bucket_id: { type: 'string' },
      version_id: { type: 'string', description: 'export_version' },
      include_rejected: {
        type: 'boolean',
        description: 'create_version: also freeze images reviewed No, each with review "rejected" and the labels rejected',
      },
      description: { type: 'string' },
      ...common,
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: buckets,
};
