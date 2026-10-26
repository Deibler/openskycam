import type { RunRequest } from './runInferencemodel';
import type { Edge, Node, Viewport } from '@xyflow/react';
import type { ModelCatalogEntry } from '../../../../src/models/modelInferencemodel';
import type { Overview, Segment } from '../../../lib/types';
import type { ConditionStep } from './conditionInferencemodel';
import type { WorkshopBucket } from './bucketInferencemodel';

export type InputStep = { kind: 'input'; label: string; bucketId: string; camera: string; includeRejected?: boolean };
export type FootageStep = {
  kind: 'footage';
  label: string;
  day: string;
  from: string;
  until: string;
  interval: number;
  /** Which frame each interval keeps: the first after its tick (default), or the one with the most new light. */
  pick?: 'first' | 'change';
};
export type ModelStep = { kind: 'model'; label: string; modelKey: string; score: number };
export type OutputStep = { kind: 'output'; label: string; bucketId: string };
export type NothingStep = { kind: 'nothing'; label: string };
export type ScheduleTrigger = 'time' | 'arrival' | 'workflow';
/** Starts the workflow. Times are UTC, like the footage filter. */
export type ScheduleStep = {
  kind: 'schedule';
  label: string;
  trigger: ScheduleTrigger;
  days: number[];
  at: string;
  workflowId: string;
  onlyIf: boolean;
};
export type WorkflowStep =
  | InputStep
  | FootageStep
  | ModelStep
  | ConditionStep
  | OutputStep
  | NothingStep
  | ScheduleStep;
export type AddableStep = 'model' | 'condition' | 'footage' | 'nothing' | 'schedule';
export type WorkflowNode = Node<WorkflowStep, 'workshop'>;
export type WorkflowEdge = Edge;
export interface WorkflowDraft {
  id: string;
  name: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: Viewport;
}
export interface WorkshopDocument {
  version: 3;
  workflows: WorkflowDraft[];
  buckets: WorkshopBucket[];
}
export type WorkshopPage =
  | 'overview'
  | 'workflow'
  | 'editor'
  | 'buckets'
  | 'bucket'
  | 'models'
  | 'runs'
  | 'run'
  | 'review';
/** `item` is the sighting frame a review page opens on. */
export interface WorkshopRoute {
  page: WorkshopPage;
  id: string;
  item: string;
}
export interface WorkflowIssue {
  nodeId?: string;
  message: string;
}
export interface WorkshopCatalog {
  models: ModelCatalogEntry[];
  overview: Overview | null;
  loading: boolean;
  error: string;
}
export interface FootageSummary {
  clips: Segment[];
  seconds: number;
  bytes: number;
  samples: number;
}
export interface DraftReadResult {
  document: WorkshopDocument;
  error: string;
}
export type WorkflowMutation = (workflow: WorkflowDraft) => WorkflowDraft;
export type StepKind = WorkflowStep['kind'];
export type DataKind = 'video' | 'frames' | 'labels';
export type NodeSettingsScreen =
  | 'overview'
  | 'bucket'
  | 'createBucket'
  | 'camera'
  | 'model'
  | 'parameters'
  | 'recordedDay'
  | 'sampling'
  | 'frameChoice'
  | 'timeRange'
  | 'sourcePreview'
  | 'trigger'
  | 'followed';
export interface ScheduleOutcome {
  workflow_id: string;
  trigger_key: string;
  status: 'started' | 'skipped' | 'failed';
  message: string;
  run_id: string | null;
  checked_at: string;
}
export interface NodeSettingsOption {
  value: string;
  label: string;
  description?: string;
}

export interface WorkflowEditorProps {
  workflow: WorkflowDraft;
  workflows: WorkflowDraft[];
  buckets: WorkshopBucket[];
  catalog: WorkshopCatalog;
  theme: 'light' | 'dark';
  onRun?: (request: RunRequest) => Promise<string>;
  onOpenRun?: (id: string) => void;
  saving?: boolean;
  saveFailed?: boolean;
  onUpdate: (mutation: WorkflowMutation) => void;
  onBack: () => void;
  onDelete?: () => void;
  onOpenBucket: (id: string) => void;
  onCreateBucket: (name: string, description: string) => WorkshopBucket;
}
