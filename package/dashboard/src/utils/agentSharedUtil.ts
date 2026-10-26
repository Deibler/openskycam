import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { AgentContent } from '../models/agentSharedmodel';
import type { WorkshopAnnotation, WorkshopEdge, WorkshopNode } from '../models/workshopInferencemodel';

const wrong = (message: string): never => {
  throw new ApplicationError('invalid_input', message);
};

/** The tool's action, or a message listing the valid ones. */
export function action(args: JsonObject, allowed: readonly string[]) {
  if (typeof args.action === 'string' && allowed.includes(args.action)) return args.action;
  return wrong(`Choose an action: ${allowed.join(', ')}.`);
}
export function text(args: JsonObject, name: string, required = false, max = 200): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === '')
    return required ? wrong(`${name} is required.`) : undefined;
  if (typeof value !== 'string' || value.length > max)
    return wrong(`${name} must be text of at most ${max} characters.`);
  return value;
}
export function number(args: JsonObject, name: string, min: number, max: number, fallback?: number): number {
  const value = args[name] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    return wrong(`${name} must be a number from ${min} to ${max}.`);
  return value;
}
export function ids(args: JsonObject, name: string, max: number): string[] {
  const value = args[name];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    value.some(v => typeof v !== 'string' || v.length > 200)
  )
    return wrong(`${name} must list 1 to ${max} IDs.`);
  return [...new Set(value as string[])];
}

/** A tool reply: compact JSON, plus an optional next step for the agent. */
export function reply(value: unknown, next?: string): AgentContent[] {
  return [{ type: 'text', text: JSON.stringify(next ? { ...(value as object), next } : value) }];
}

/** Predictions as agents read them: rounded, with normalized [x1, y1, x2, y2] boxes. */
export function detections(annotationJson: string, limit = 20) {
  const all = JSON.parse(annotationJson) as WorkshopAnnotation[];
  return {
    count: all.length,
    top: all
      .toSorted((a, b) => b.confidence - a.confidence)
      .slice(0, limit)
      .map(a => ({
        class: a.class_name,
        confidence: Math.round(a.confidence * 1000) / 1000,
        ...(a.box ? { box: a.box.map(n => Math.round(n * 10000) / 10000) } : {}),
      })),
  };
}

/**
 * Lays out steps an agent added (their x is NaN): one column per step from the input, in the first
 * row of that column no step already occupies, so a new step never lands on an existing one.
 */
export function place(nodes: WorkshopNode[], edges: WorkshopEdge[]) {
  const depth = new Map<string, number>(nodes.filter(n => n.data.kind === 'schedule').map(n => [n.id, -1]));
  const queue = nodes.filter(n => n.data.kind === 'input').map(n => n.id);
  queue.forEach(id => depth.set(id, 0));
  for (const id of queue)
    for (const e of edges.filter(e => e.source === id && !depth.has(e.target))) {
      depth.set(e.target, depth.get(id)! + 1);
      queue.push(e.target);
    }
  // A step card is at most 264 × 177 px.
  const taken = (x: number, y: number) =>
    nodes.some(o => Math.abs(o.position.x - x) < 280 && Math.abs(o.position.y - y) < 180);
  for (const n of nodes)
    if (!Number.isFinite(n.position.x)) {
      const x = (depth.get(n.id) ?? Math.max(0, ...depth.values()) + 1) * 320;
      let y = 100;
      while (taken(x, y)) y += 190;
      n.position = { x, y };
    }
}
