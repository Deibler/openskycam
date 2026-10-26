import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { MachineApp } from './applicationSharedmodel';

/** One MCP content block. Images are base64 JPEG. */
export type AgentContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/jpeg' };

/** An MCP tool: one per area of the site, with an `action` argument choosing the operation. */
export interface AgentTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  run: (app: MachineApp, args: JsonObject) => Promise<AgentContent[]>;
}

/** A markdown page an agent reads through the guide tool, as a resource, or (skills) as a prompt. */
export interface AgentGuide {
  name: string;
  kind: 'guides' | 'skills';
  title: string;
  description: string;
}

/** A workflow step as agents read and write it: the node's settings, flattened beside its kind. */
export interface AgentStep {
  id: string;
  kind: string;
  label: string;
  [setting: string]: unknown;
}

/** A connection from one step's port into another step. */
export interface AgentLink {
  from: string;
  to: string;
  port: string;
}
