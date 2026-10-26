import type { ModelVersion } from './modelInferencemodel';
import type { RecordingRow } from './footageStoragemodel';
export interface Bucket {
  id: string;
  name: string;
  kind: 'raw' | 'labeled';
  description: string;
  createdAt: string | null;
}
export interface WorkshopNode {
  id: string;
  type: 'workshop';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface WorkshopEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}
export interface Workflow {
  id: string;
  name: string;
  updatedAt: string;
  nodes: WorkshopNode[];
  edges: WorkshopEdge[];
  viewport?: { x: number; y: number; zoom: number };
}
export interface WorkshopDocument {
  version: 3;
  buckets: Bucket[];
  workflows: Workflow[];
}
export interface WorkshopState {
  revision: number;
  document: WorkshopDocument;
}
export interface WorkshopStateRow {
  revision: number;
  document_json: string;
}
export interface WorkshopRuntime {
  id: string;
  device_id: string;
  code_sha256: string;
  manifest_json: string;
  created_at: string;
  last_seen_at: string | null;
}
export interface WorkshopModel {
  node_id: string;
  model: ModelVersion;
  artifact_sha256: string;
  imgsz: number;
  confidence: number;
}
export interface WorkshopSnapshot {
  schema_version: 1;
  mode?: 'test' | 'run';
  image_limit?: number;
  expected_images?: number;
  preview_expires_at?: string;
  workflow: Workflow;
  models: WorkshopModel[];
  runtime: WorkshopRuntime;
  input_bucket: string;
  output_buckets: string[];
  interval: number;
  /** Set when the footage step keeps the frame with the most new light in each interval, not the first. */
  pick?: 'change';
  from: string | null;
  until: string | null;
}
export interface WorkshopRun {
  id: string;
  request_hash: string;
  workflow_id: string;
  name: string;
  runtime_id: string;
  snapshot_json: string;
  created_at: string;
}
export interface WorkshopRunStatus extends WorkshopRun {
  total: number;
  completed: number;
  failed: number;
  expired: number;
  queued: number;
  leased: number;
  cancelled: number;
  images: number;
  pending: number;
  accepted: number;
  rejected: number;
}
export interface WorkshopInput {
  kind: 'video' | 'image';
  sample_limit?: number;
  recording: RecordingRow | null;
  item: WorkshopItem | null;
  from: number;
  until: number;
}
export interface WorkshopJob {
  id: string;
  run_id: string;
  cam: string;
  input_json: string;
  expires_at: string;
  status: string;
  generation: number;
  lease_token: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  result_sha256: string | null;
  error: string | null;
  progress_json: string;
  expected_images: number;
}
export interface WorkshopLease {
  generation: unknown;
  lease_token: unknown;
}
export interface WorkshopAnnotation {
  class_id: number;
  model_class_id?: number;
  class_name: string;
  confidence: number;
  box?: number[];
  model_node: string;
  /** Set when a reviewer changed the model's label. */
  edited?: boolean;
  /** The object this box belongs to across its recording: one of the image's provenance `tracks`. */
  track_id?: string;
}
export type WorkshopMotion = 'moving' | 'stationary' | 'brief';
/** A track measured in every decoded frame. `samples` are [t, x | null, y | null, peak] within 2 s of the image. */
export interface WorkshopScan {
  fps: number;
  searched: number;
  seen: number;
  speed: number | null;
  first: number | null;
  last: number | null;
  samples: (number | null)[][];
}
/**
 * One object across a recording, as the processor followed it. Times are seconds into the recording; speeds
 * are frame heights per second. `path` lists each detection: t, x, y, width, height (fractions of the frame),
 * class_id, confidence. `clipped` edges may extend past the processed window.
 */
export interface WorkshopTrack {
  id: string;
  motion: WorkshopMotion;
  speed: number | null;
  start: number;
  end: number;
  detections: number;
  clipped?: ('start' | 'end')[];
  path: number[][];
  scan?: WorkshopScan;
}
export interface WorkshopFrame {
  bucket_id: string;
  model_node: string;
  pts: number;
  time_base: [number, number];
  offset: number;
  width: number;
  height: number;
  sha256: string;
  annotations: WorkshopAnnotation[];
  tracks?: WorkshopTrack[];
}
export interface WorkshopItem {
  id: string;
  bucket_id: string;
  asset_id: string;
  run_id: string;
  job_id: string;
  source_sha256: string;
  cam: string;
  captured_at: string;
  object_key: string;
  sha256: string;
  expires_at: string;
  annotation_json: string;
  provenance_json: string;
  review: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}
/** `manifest_json` is the manifest without its items, which are stored one per row. */
export interface WorkshopVersion {
  id: string;
  bucket_id: string;
  name: string;
  manifest_json: string;
  sha256: string;
  created_at: string;
}
export type WorkshopVersionSummary = Omit<WorkshopVersion, 'manifest_json'> & { images: number };
export interface WorkshopUpload {
  object_key: string;
  job_id: string;
  generation: number;
  sha256: string;
  bytes: number;
  expires_at: string;
}
export interface WorkshopSeed {
  expected_images: number;
  id: string;
  cam: string;
  input_json: string;
  expires_at: string;
}
export interface WorkshopVersionEntry {
  item_id: string;
  cam: string;
  media_path: string;
  asset_id: string;
  sha256: string;
  source_sha256: string;
  captured_at: string;
  expires_at: string;
  /** A rejected entry keeps the labels the reviewer said No to. */
  review: 'accepted' | 'rejected';
  annotations: WorkshopAnnotation[];
  provenance: Record<string, unknown>;
  split: 'train' | 'validation' | 'test';
}
export interface WorkshopVersionManifest {
  schema_version: 1;
  bucket_id: string;
  class_names: string[];
  split_policy: string;
  created_at: string;
  items: WorkshopVersionEntry[];
}

export type WorkshopPhase = 'downloading' | 'loading_model' | 'processing' | 'uploading' | 'finalizing';
export interface WorkshopProgress {
  phase: WorkshopPhase;
  node_id: string | null;
  processed: number;
  updated_at: string;
}
export interface WorkshopRunImage extends WorkshopItem {
  image_url: string;
}
export interface WorkshopPreviewRow {
  item_json: string;
}
export interface WorkshopRunJob {
  id: string;
  status: string;
  expected: number;
  processed: number;
  error: string | null;
  progress: WorkshopProgress | null;
}
export interface WorkshopRunStep {
  id: string;
  kind: string;
  label: string;
}
export interface WorkshopRunDetail {
  id: string;
  name: string;
  workflow_id: string;
  mode: 'test' | 'run';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  created_at: string;
  preview_expires_at: string | null;
  requested_images: number | null;
  expected_images: number;
  processed_images: number;
  output_buckets: string[];
  workflow: Workflow;
  steps: WorkshopRunStep[];
  jobs: WorkshopRunJob[];
  images: WorkshopRunImage[];
  has_more: boolean;
}
export type WorkshopScheduleTrigger = 'time' | 'arrival' | 'workflow';
/** Starts a workflow. Times are UTC, matching the footage filter. */
export interface WorkshopScheduleStep {
  kind: 'schedule';
  label: string;
  trigger: WorkshopScheduleTrigger;
  days: number[];
  at: string;
  workflowId: string;
  onlyIf: boolean;
}
export interface WorkshopScheduleOutcome {
  workflow_id: string;
  trigger_key: string;
  status: 'started' | 'skipped' | 'failed';
  message: string;
  run_id: string | null;
  checked_at: string;
}
export interface WorkshopScheduleDue {
  key: string;
  label: string;
  found?: boolean;
}
export interface WorkshopFinishedRun {
  id: string;
  finished_at: string;
  images: number;
}
/** Scheduler-only run inputs. `since` makes the run incremental; null means no earlier scheduled run. */
export interface WorkshopRunOptions {
  now?: Date;
  since?: string | null;
  name?: string;
}
/** Image search filters. Every filter is optional except the cameras the caller may see. */
export interface WorkshopItemSearch {
  cameras: string[];
  bucket: string | null;
  run: string | null;
  review: string | null;
  from: string | null;
  to: string | null;
  className: string | null;
  minConfidence: number | null;
  limit: number;
  offset: number;
}
export interface WorkshopBucketCount {
  bucket_id: string;
  images: number;
  accepted: number;
  rejected: number;
  pending: number;
  saved: number;
  last_added_at: string | null;
}
export interface WorkshopClassStat {
  workflow_id: string;
  class_name: string;
  detections: number;
  images: number;
  accepted: number;
  rejected: number;
}
export interface WorkshopDailyStat {
  workflow_id: string;
  day: string;
  images: number;
}
export interface WorkshopWorkflowStats {
  workflow_id: string;
  runs: number;
  last_run: WorkshopRunStatus | null;
  images: number;
  accepted: number;
  rejected: number;
  pending: number;
  classes: Omit<WorkshopClassStat, 'workflow_id'>[];
  daily: Omit<WorkshopDailyStat, 'workflow_id'>[];
}
/** Counts behind the Workshop overview, the buckets page, and a workflow's statistics. */
export interface WorkshopSummary {
  buckets: WorkshopBucketCount[];
  workflows: WorkshopWorkflowStats[];
}
export interface WorkshopRecording {
  cam: string;
  start: string;
  size: number;
  duration_s: number | null;
  frames: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  codec: string | null;
}
/** Everything the run review page needs: the run's recordings for the player and every sighting frame, oldest first. */
export interface WorkshopRunReview {
  run: {
    id: string;
    name: string;
    workflow_id: string;
    mode: 'test' | 'run';
    created_at: string;
    output_buckets: string[];
  };
  recordings: WorkshopRecording[];
  classes: { node_id: string; classes: { id: number; name: string }[] }[];
  items: WorkshopRunImage[];
  has_more: boolean;
}
