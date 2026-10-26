import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';
import type { MachineApp } from '../models/applicationSharedmodel';
import type { AgentTool } from '../models/agentSharedmodel';
import { action, reply, text } from '../utils/agentSharedUtil';
import { modelCatalog } from './modelCatalogInferenceService';
import { assign, devices, registerDevice } from './modelInferenceService';
import { workshopModelIssue } from './workshopInferenceService';

async function models(app: MachineApp, args: JsonObject) {
  switch (action(args, ['list', 'get', 'devices', 'register_device', 'deploy'])) {
    case 'list': {
      const { models } = await modelCatalog(app.env);
      return reply(
        {
          models: models.map(m => {
            const issue = workshopModelIssue(m);
            return {
              model_key: `${m.family}/${m.version}`,
              name: m.name,
              task: m.task,
              classes: m.classes.map(c => c.name),
              workflow_ready: !issue,
              ...(issue ? { issue } : {}),
            };
          }),
        },
        "Use a workflow_ready model_key as a model step's modelKey. models get shows evaluations and caveats.",
      );
    }
    case 'get': {
      const key = text(args, 'model_key', true)!;
      const model = (await modelCatalog(app.env)).models.find(m => `${m.family}/${m.version}` === key);
      if (!model) throw new ApplicationError('not_found', 'Model not found. models list shows model_key values.');
      return reply({ model_key: key, ...model, workflow_issue: workshopModelIssue(model) });
    }
    case 'devices':
      return reply(await devices(app.env));
    case 'register_device':
      return reply(await registerDevice(app.env, { id: text(args, 'device_id', true) }));
    default: {
      const deployment = await assign(app.env, text(args, 'device_id', true)!, {
        previous_revision: args.previous_revision ?? null,
        models: args.models,
      });
      return reply(
        {
          device_id: deployment.device_id,
          revision: deployment.revision,
          models: deployment.models.map(m => ({
            slot: m.slot,
            model_key: `${m.model.family}/${m.model.version}`,
            parameters: m.parameters,
          })),
        },
        'The device downloads these on its next sync. models devices shows its reported status.',
      );
    }
  }
}

export const modelsTool: AgentTool = {
  name: 'models',
  title: 'Models and devices',
  description:
    "Registered detection and classification models, and edge devices that run them. Actions: list (model_key, classes, and whether a workflow can use it); get (one model's full manifest: evaluations, caveats, artifacts); devices (devices and their deployments); register_device; deploy (set a device's models; pass previous_revision from devices). Read guide models first.",
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'get', 'devices', 'register_device', 'deploy'] },
      model_key: { type: 'string', description: 'get: family/version, e.g. combined-detector/v2' },
      device_id: { type: 'string', description: 'register_device/deploy' },
      previous_revision: {
        type: ['string', 'null'],
        description: "deploy: the device's current deployment revision (null if none)",
      },
      models: {
        type: 'array',
        items: { type: 'object' },
        description:
          'deploy: [{slot, family, version, sha256, parameters: {imgsz, confidence, iou, device}}]; empty unloads all',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: models,
};
