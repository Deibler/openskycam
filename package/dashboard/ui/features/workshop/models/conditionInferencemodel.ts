export type ConditionRuleKind = 'time' | 'weekday' | 'class' | 'confidence' | 'count' | 'motion';
export type ConditionPreset = ConditionRuleKind | 'all' | 'any';
export type ConditionRule =
  | { id: string; kind: 'time'; from: string; until: string; timeZone: string }
  | { id: string; kind: 'weekday'; days: number[]; timeZone: string }
  | { id: string; kind: 'class'; className: string; operator: 'present' | 'absent' }
  | { id: string; kind: 'confidence'; className: string; operator: 'at-least' | 'below'; threshold: number }
  | { id: string; kind: 'count'; className: string; operator: 'at-least' | 'equal' | 'at-most'; count: number }
  | { id: string; kind: 'motion'; className: string; operator: 'moving' | 'stationary' | 'brief' };
export type ConditionStep = { kind: 'condition'; label: string; match: 'all' | 'any'; rules: ConditionRule[] };
export type ConditionSettingsScreen = { page: 'overview' } | { page: 'add' } | { page: 'rule'; id: string };
export interface ConditionChoice {
  kind: ConditionPreset;
  title: string;
  description: string;
}
export interface LegacyConditionStep {
  kind: 'condition';
  label: string;
  field: 'time' | 'confidence' | 'class';
  from: string;
  until: string;
  threshold: number;
  className: string;
}
