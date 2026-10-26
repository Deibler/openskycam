import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { MachineApp } from '../models/applicationSharedmodel';
import type { AgentTool } from '../models/agentSharedmodel';
import { guides, guideTool, guideUri, readGuide } from './agentGuideSharedService';
import { footageTool } from './agentFootageStorageService';
import { bucketsTool, workflowsTool } from './agentWorkflowInferenceService';
import { runsTool } from './agentRunInferenceService';
import { imagesTool } from './agentImageInferenceService';
import { modelsTool } from './agentModelInferenceService';

/** Seven tools cover the whole site; each takes an `action`. */
export const tools: AgentTool[] = [
  guideTool,
  footageTool,
  workflowsTool,
  runsTool,
  imagesTool,
  bucketsTool,
  modelsTool,
];
const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
// Claude Code shows at most 2,048 characters of these.
const instructions = `openskycam is a sky-camera site: stored video (footage), Workshop workflows that sample frames from video and run detection models on the processor, buckets of labeled images, and datasets.

Before acting, call guide (no topic), then guide overview, then the guide for the area you will touch. Skills are step-by-step recipes: build-a-workflow, find-detections, take-photos, download-footage, verify-changes.

Rules:
- Times are UTC ISO 8601.
- Workshop edits take the revision you last read; on a conflict, read again and reapply.
- Delete shows a preview first. Confirm only what the user asked to delete.
- Test a workflow (runs test) before a full run (runs start), then follow it with runs watch until finished.
- After any change, verify it by reading it back (guide verify-changes). Report what you observed, not what you attempted.
- Download links are short-lived and grant access to their file: give them only to the user.`;

const failure = (text: string) => ({ content: [{ type: 'text', text }], isError: true });

async function call(app: MachineApp, params: JsonObject) {
  const tool = tools.find(t => t.name === params.name);
  const args = (
    params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}
  ) as JsonObject;
  // Workers Logs keeps this: which key did what.
  console.log(
    JSON.stringify({
      event: 'agent_tool',
      key: app.principal.id,
      tool: String(params.name),
      action: typeof args.action === 'string' ? args.action : null,
    }),
  );
  if (!tool) return failure(`Unknown tool ${String(params.name)}. Tools: ${tools.map(t => t.name).join(', ')}.`);
  try {
    return { content: await tool.run(app, args) };
  } catch (error) {
    if (error instanceof ApplicationError) return failure(error.message);
    console.error('Agent tool failed', tool.name, error);
    return failure('The action failed unexpectedly and may not have finished. Read the current state before retrying.');
  }
}

/** One MCP request. Returns undefined for a method this server does not have. */
export async function mcp(app: MachineApp, method: string, params: JsonObject): Promise<unknown> {
  if (app.principal.scope !== 'agent')
    throw new ApplicationError(
      'forbidden',
      'The MCP server needs an Agent key. Create one on the website under API access.',
    );
  const skill = () => {
    const found = guides.find(g => g.kind === 'skills' && g.name === params.name);
    if (!found)
      throw new ApplicationError(
        'invalid_input',
        `Unknown prompt. Prompts: ${guides
          .filter(g => g.kind === 'skills')
          .map(g => g.name)
          .join(', ')}.`,
      );
    return found;
  };
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: versions.includes(String(params.protocolVersion)) ? params.protocolVersion : versions[0],
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'openskycam', title: 'OpenSkyCam', version: '1.0.0' },
        instructions,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: tools.map(({ run: _, ...tool }) => tool) };
    case 'tools/call':
      return call(app, params);
    case 'resources/list':
      return {
        resources: guides.map(g => ({
          uri: guideUri(g),
          name: g.name,
          title: g.title,
          description: g.description,
          mimeType: 'text/markdown',
        })),
      };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'resources/read': {
      const { guide, page } = await readGuide(app.env, params.uri);
      return { contents: [{ uri: guideUri(guide), mimeType: 'text/markdown', text: page }] };
    }
    case 'prompts/list':
      return {
        prompts: guides
          .filter(g => g.kind === 'skills')
          .map(g => ({ name: g.name, title: g.title, description: g.description })),
      };
    case 'prompts/get': {
      const { guide, page } = await readGuide(app.env, skill().name);
      return {
        description: guide.description,
        messages: [
          { role: 'user', content: { type: 'text', text: `Use the openskycam tools to do this.\n\n${page}` } },
        ],
      };
    }
    default:
      return undefined;
  }
}
