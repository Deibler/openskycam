import type { ModelVersion } from '../../../../src/models/modelInferencemodel';
import type {
  ConditionChoice,
  ConditionPreset,
  ConditionRule,
  ConditionRuleKind,
  ConditionStep,
} from '../models/conditionInferencemodel';
import type { WorkflowDraft } from '../models/workflowInferencemodel';
import { modelKey } from '../../../lib/model-library';
import { conditionTitle, conditionTitles } from '../utils/conditionInferenceUtil';

export const conditionChoices: ConditionChoice[] = [
  { kind: 'time', title: conditionTitles.time, description: 'Between two times, including overnight' },
  { kind: 'weekday', title: conditionTitles.weekday, description: 'Only on the days you choose' },
  { kind: 'class', title: conditionTitles.class, description: 'An image has—or does not have—a label' },
  { kind: 'confidence', title: conditionTitles.confidence, description: 'A prediction meets a score threshold' },
  { kind: 'count', title: conditionTitles.count, description: 'How many objects are in an image' },
  { kind: 'motion', title: conditionTitles.motion, description: 'An object moves, stays still, or is seen too briefly' },
  { kind: 'all', title: conditionTitles.all, description: 'Every check must match · AND' },
  { kind: 'any', title: conditionTitles.any, description: 'At least one check must match · OR' },
];
/** Single checks, then the ways to combine them. */
export const ruleChoices = conditionChoices.filter(choice => choice.kind !== 'all' && choice.kind !== 'any');
export const combineChoices = conditionChoices.filter(choice => choice.kind === 'all' || choice.kind === 'any');
export function newConditionRule(kind: ConditionRuleKind): ConditionRule {
  const id = crypto.randomUUID();
  switch (kind) {
    case 'time':
      return { id, kind, from: '07:00', until: '19:00', timeZone: 'UTC' };
    case 'weekday':
      return { id, kind, days: [1, 2, 3, 4, 5], timeZone: 'UTC' };
    case 'class':
      return { id, kind, className: '', operator: 'present' };
    case 'confidence':
      return { id, kind, className: '', operator: 'at-least', threshold: 0.7 };
    case 'count':
      return { id, kind, className: '', operator: 'at-least', count: 1 };
    case 'motion':
      return { id, kind, className: '', operator: 'moving' };
  }
}
export function newCondition(preset: ConditionPreset = 'time'): ConditionStep {
  const rules =
    preset === 'all' || preset === 'any'
      ? [newConditionRule('time'), newConditionRule('weekday')]
      : [newConditionRule(preset)];
  const step: ConditionStep = { kind: 'condition', label: '', match: preset === 'any' ? 'any' : 'all', rules };
  return { ...step, label: conditionTitle(step) };
}
export function ruleIssues(rule: ConditionRule): string[] {
  const issues: string[] = [];
  if (rule.kind === 'time' || rule.kind === 'weekday') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: rule.timeZone });
      if (!rule.timeZone.trim()) throw new Error();
    } catch {
      issues.push('Enter a valid time zone, such as UTC or America/New_York.');
    }
  }
  if (
    rule.kind === 'time' &&
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.from) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.until) ||
      rule.from === rule.until)
  )
    issues.push('Choose different start and end times.');
  if (rule.kind === 'weekday' && !rule.days.length) issues.push('Choose at least one day.');
  if (rule.kind === 'class' && !rule.className.trim()) issues.push('Choose the class to check.');
  if (rule.kind === 'confidence' && (!Number.isFinite(rule.threshold) || rule.threshold < 0 || rule.threshold > 1))
    issues.push('Confidence must be between 0% and 100%.');
  if (rule.kind === 'count' && (!Number.isSafeInteger(rule.count) || rule.count < 0))
    issues.push('Use a whole number of detections, starting at zero.');
  return issues;
}
/** Conditions inspect the nearest model on their input path, not every model on the canvas. */
export function upstreamModel(
  workflow: WorkflowDraft,
  nodeId: string,
  models: ModelVersion[],
): ModelVersion | undefined {
  const seen = new Set<string>();
  let input = workflow.edges.find(edge => edge.target === nodeId);
  while (input && !seen.has(input.source)) {
    seen.add(input.source);
    const data = workflow.nodes.find(node => node.id === input!.source)?.data;
    if (data?.kind === 'model') return models.find(model => modelKey(model) === data.modelKey);
    if (data?.kind !== 'condition') return undefined;
    input = workflow.edges.find(edge => edge.target === input!.source);
  }
  return undefined;
}
export function conditionIssues(step: ConditionStep, model?: ModelVersion): string[] {
  const issues = step.rules.flatMap(rule => ruleIssues(rule));
  for (const rule of step.rules) {
    if (rule.kind === 'count' && model && model.task !== 'object-detection')
      issues.push('Detection count needs an object detection model before this step.');
    if (rule.kind === 'motion' && model && model.task !== 'object-detection')
      issues.push('Motion needs an object detection model before this step.');
    if (
      'className' in rule &&
      rule.className.trim() &&
      model?.classes.length &&
      !model.classes.some(item => item.name === rule.className)
    )
      issues.push(`“${rule.className}” is not an output class of ${model.name}.`);
  }
  return issues;
}
