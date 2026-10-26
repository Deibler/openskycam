import type {
  ConditionPreset,
  ConditionRule,
  ConditionStep,
  LegacyConditionStep,
} from '../models/conditionInferencemodel';

export const conditionTitles: Record<ConditionPreset, string> = {
  time: 'Time window',
  weekday: 'Days of the week',
  class: 'Class present',
  confidence: 'Confidence',
  count: 'Detection count',
  motion: 'Motion',
  all: 'All conditions',
  any: 'Any condition',
};
export const weekdays = [
  { value: 1, name: 'Monday', short: 'Mon' },
  { value: 2, name: 'Tuesday', short: 'Tue' },
  { value: 3, name: 'Wednesday', short: 'Wed' },
  { value: 4, name: 'Thursday', short: 'Thu' },
  { value: 5, name: 'Friday', short: 'Fri' },
  { value: 6, name: 'Saturday', short: 'Sat' },
  { value: 0, name: 'Sunday', short: 'Sun' },
];
export function conditionTitle(step: ConditionStep): string {
  if (step.rules.length === 1 && step.rules[0].kind === 'class' && step.rules[0].operator === 'absent')
    return 'Class absent';
  return step.rules.length === 1 ? conditionTitles[step.rules[0].kind] : conditionTitles[step.match];
}
export function ruleSummary(rule: ConditionRule): string {
  switch (rule.kind) {
    case 'time':
      return `Recorded ${rule.from || '…'}–${rule.until || '…'}`;
    case 'weekday': {
      const names = weekdays.filter(day => rule.days.includes(day.value)).map(day => day.short);
      return names.length === 7
        ? 'Recorded on any day'
        : names.length
          ? `Recorded on ${names.join(', ')}`
          : 'Choose days';
    }
    case 'class':
      return rule.className
        ? `${rule.className} is ${rule.operator === 'absent' ? 'absent' : 'present'}`
        : 'Choose a class';
    case 'confidence':
      return `${rule.className || 'Any prediction'} ${rule.operator === 'below' ? '<' : '≥'} ${Math.round(rule.threshold * 100)}% confidence`;
    case 'count':
      return `${rule.operator === 'equal' ? 'Exactly' : rule.operator === 'at-most' ? 'At most' : 'At least'} ${rule.count} ${rule.className ? `${rule.className} ${rule.count === 1 ? 'detection' : 'detections'}` : rule.count === 1 ? 'object' : 'objects'}`;
    case 'motion':
      return `${rule.className || 'An object'} ${motionNames[rule.operator].toLowerCase()}`;
  }
}
export const motionNames = { moving: 'Is moving', stationary: 'Stays still', brief: 'Seen too briefly to tell' };
export function ruleContext(rule: ConditionRule): string {
  if (rule.kind === 'time') return `${rule.timeZone}${rule.from > rule.until ? ' · overnight' : ''}`;
  if (rule.kind === 'weekday') return rule.timeZone;
  if (rule.kind === 'motion') return 'Across the recording';
  return 'Per image';
}
export function requiresPredictions(step: ConditionStep): boolean {
  return step.rules.some(rule => ['class', 'confidence', 'count', 'motion'].includes(rule.kind));
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 1000;
/** Structural checks permit incomplete form values so unfinished drafts are recoverable. */
export function isConditionStep(value: unknown): value is ConditionStep {
  if (
    !object(value) ||
    value.kind !== 'condition' ||
    !text(value.label) ||
    !['all', 'any'].includes(String(value.match)) ||
    !Array.isArray(value.rules) ||
    !value.rules.length ||
    value.rules.length > 8
  )
    return false;
  const ids = new Set<string>();
  return value.rules.every(rule => {
    if (!object(rule) || !text(rule.id) || !rule.id || ids.has(rule.id)) return false;
    ids.add(rule.id);
    switch (rule.kind) {
      case 'time':
        return text(rule.from) && text(rule.until) && text(rule.timeZone);
      case 'weekday':
        return (
          text(rule.timeZone) &&
          Array.isArray(rule.days) &&
          rule.days.length <= 7 &&
          new Set(rule.days).size === rule.days.length &&
          rule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
        );
      case 'class':
        return text(rule.className) && ['present', 'absent'].includes(String(rule.operator));
      case 'confidence':
        return (
          text(rule.className) &&
          ['at-least', 'below'].includes(String(rule.operator)) &&
          typeof rule.threshold === 'number' &&
          Number.isFinite(rule.threshold) &&
          rule.threshold >= 0 &&
          rule.threshold <= 1
        );
      case 'count':
        return (
          text(rule.className) &&
          ['at-least', 'equal', 'at-most'].includes(String(rule.operator)) &&
          Number.isSafeInteger(rule.count) &&
          Number(rule.count) >= 0
        );
      case 'motion':
        return text(rule.className) && ['moving', 'stationary', 'brief'].includes(String(rule.operator));
      default:
        return false;
    }
  });
}
/** Only the in-memory copy is migrated; a read never overwrites browser storage. */
export function migrateCondition(value: unknown, nodeId: string): ConditionStep | null {
  if (
    !object(value) ||
    value.kind !== 'condition' ||
    !text(value.label) ||
    !['time', 'confidence', 'class'].includes(String(value.field)) ||
    !text(value.from) ||
    !text(value.until) ||
    !text(value.className) ||
    typeof value.threshold !== 'number' ||
    !Number.isFinite(value.threshold) ||
    value.threshold < 0 ||
    value.threshold > 1
  )
    return null;
  const old = value as unknown as LegacyConditionStep;
  const id = `${nodeId}:rule-1`;
  const rule: ConditionRule =
    old.field === 'time'
      ? { id, kind: 'time', from: old.from, until: old.until, timeZone: 'UTC' }
      : old.field === 'confidence'
        ? { id, kind: 'confidence', threshold: old.threshold, operator: 'at-least', className: '' }
        : { id, kind: 'class', className: old.className, operator: 'present' };
  return { kind: 'condition', label: conditionTitles[rule.kind], match: 'all', rules: [rule] };
}
