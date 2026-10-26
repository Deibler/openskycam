import type { MachineApp } from './applicationSharedmodel';
import type { RecordingRow } from './footageStoragemodel';
export type ProcessorApp = MachineApp;
export interface Job {
  id: string;
  pipeline_id: string;
  object_key: string;
  cam: string;
  start: string;
  input_sha256: string;
  status: string;
  generation: number;
  lease_token: string;
  lease_owner: string;
  lease_until: string;
  expires_at: string;
  result_sha256: string | null;
  result_key: string | null;
}
export interface Pipeline {
  id: string;
  model_sha256: string;
  code_sha256: string;
  config_sha256: string;
  config_json: string;
}
export type JobInput = Omit<RecordingRow, 'bitrate'>;
export interface ClaimedJob {
  id: string;
  generation: number;
  lease_token: string;
  lease_until: string;
  expires_at: string;
  input: JobInput;
  pipeline: Omit<Pipeline, 'config_json'> & { config: Record<string, unknown> };
}
export interface ClaimResult {
  job: ClaimedJob | null;
}
export interface LeaseResult {
  lease_until: string;
}
export interface JobState {
  status: string;
}
export interface ReconcileResult {
  enqueued: number;
}
export interface SourceDuration {
  duration_s: number | null;
}
export interface ResultKey {
  result_key: string;
}
export interface JobCount {
  pipeline_id: string;
  cam: string;
  status: string;
  jobs: number;
  processed_seconds: number | null;
}
export interface RecentJob {
  id: string;
  pipeline_id: string;
  cam: string;
  start: string;
  status: string;
  attempts: number;
  error: string | null;
  completed_at: string | null;
  result_sha256: string | null;
  processed_seconds: number | null;
  sampled_frames: number | null;
  elapsed_seconds: number | null;
}
export interface InferenceStatus {
  counts: JobCount[];
  recent: RecentJob[];
}

/** Service-selected policy values used by the bounded reconciliation query. */
export interface ReconcileWindow {
  pipeline: string;
  cam: string;
  from: string;
  to: string;
  cutoff: string;
  now: string;
  retentionSeconds: number;
  maxJobs: number;
}
