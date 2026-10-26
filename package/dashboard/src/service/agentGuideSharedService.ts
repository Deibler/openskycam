import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { Env, MachineApp } from '../models/applicationSharedmodel';
import type { AgentGuide, AgentTool } from '../models/agentSharedmodel';
import { guideText } from '../db/GuideSharedOps';
import { text } from '../utils/agentSharedUtil';

/** Pages live in ui/public/agent/<kind>/<name>.md. Skills are also offered as MCP prompts. */
export const guides: AgentGuide[] = [
  {
    name: 'overview',
    kind: 'guides',
    title: 'Start here',
    description: 'What openskycam holds, how the tools fit together, IDs, times, and safety rules.',
  },
  {
    name: 'footage',
    kind: 'guides',
    title: 'Footage and photos',
    description: 'Cameras, recorded days, recordings, download links, and photos from stored video.',
  },
  {
    name: 'workflows',
    kind: 'guides',
    title: 'Workflows',
    description: 'Steps, settings, connections, schedules, and the rules a runnable workflow must meet.',
  },
  {
    name: 'runs',
    kind: 'guides',
    title: 'Runs',
    description: 'Test runs, full runs, live progress, cancelling, schedules, and processors.',
  },
  {
    name: 'images',
    kind: 'guides',
    title: 'Images and buckets',
    description: 'Searching detections, viewing and cropping images, review, saving, buckets, and dataset versions.',
  },
  {
    name: 'models',
    kind: 'guides',
    title: 'Models',
    description: 'Which models a workflow can use, their classes, and device deployments.',
  },
  {
    name: 'build-a-workflow',
    kind: 'skills',
    title: 'Build and run a workflow',
    description: 'Create a workflow from scratch, test it on a few frames, then run it and watch it finish.',
  },
  {
    name: 'find-detections',
    kind: 'skills',
    title: 'Find and review detections',
    description: 'Search saved detections by class, confidence, and time, look at them, and accept or reject them.',
  },
  {
    name: 'take-photos',
    kind: 'skills',
    title: 'Take photos from recordings',
    description: 'Find when footage exists and pull still frames from stored video.',
  },
  {
    name: 'download-footage',
    kind: 'skills',
    title: 'Download footage',
    description: 'Get curl-ready links for one recording or a time range and save the files.',
  },
  {
    name: 'verify-changes',
    kind: 'skills',
    title: 'Verify your changes',
    description: 'The checks to run after any change so you report outcomes, not attempts.',
  },
];

export const guideUri = (g: AgentGuide) => `openskycam://${g.kind}/${g.name}`;

export async function readGuide(env: Env, name: unknown) {
  const guide = guides.find(g => g.name === name || guideUri(g) === name);
  if (!guide)
    throw new ApplicationError(
      'not_found',
      `No guide named ${String(name)}. Topics: ${guides.map(g => g.name).join(', ')}.`,
    );
  const page = await guideText(env, `${guide.kind}/${guide.name}`);
  if (!page) throw new ApplicationError('unavailable', 'Guides are unavailable in this deployment.');
  return { guide, page };
}

async function guide(app: MachineApp, args: JsonObject) {
  const topic = text(args, 'topic');
  if (topic) return [{ type: 'text' as const, text: (await readGuide(app.env, topic)).page }];
  const list = (kind: AgentGuide['kind']) =>
    guides
      .filter(g => g.kind === kind)
      .map(g => `- ${g.name}: ${g.description}`)
      .join('\n');
  return [
    {
      type: 'text' as const,
      text: `# openskycam guides\n\nRead overview first. Then read the guide for the area you are about to change.\n\n## Guides\n${list('guides')}\n\n## Skills (step-by-step)\n${list('skills')}\n\nCall guide with topic set to a name above.`,
    },
  ];
}

export const guideTool: AgentTool = {
  name: 'guide',
  title: 'Guides and skills',
  description:
    'Read how openskycam works before acting. No topic returns the index; topic returns one guide or step-by-step skill (e.g. overview, workflows, build-a-workflow, verify-changes).',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', enum: guides.map(g => g.name), description: 'Guide or skill name. Omit for the index.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  run: guide,
};
