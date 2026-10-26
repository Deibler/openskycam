export type Point = { t: number; box: number[]; score: number };
export type Track = {
  track_id: number;
  label: string;
  score: number;
  points: Point[];
  evidence_sha256?: string;
};
export type Result = {
  provenance: {
    input_sha256: string;
    model_sha256: string;
    code_sha256: string;
    config_sha256: string;
    runtime: Record<string, unknown>;
  };
  metrics: {
    processed_seconds: number;
    elapsed_seconds: number;
    sampled_frames: number;
    decoded_frames: number;
  };
  tracks: Track[];
};
export interface CompletedResult {
  job_id: string;
  status: 'completed';
  result_sha256: string;
}
export interface EvidenceResult {
  sha256: string;
}
export interface TrackEvent {
  track_id: number;
  label: string;
  score: number;
  start: string;
  end: string;
  expires_at: string;
}
