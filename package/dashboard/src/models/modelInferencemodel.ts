import type { JsonObject } from '../../../shared/src/models/httpSharedmodel';

export interface ModelClass {
  id: number;
  name: string;
}
export interface ModelArtifact {
  sha256: string;
  bytes: number;
  filename: string;
  format: string;
}
export interface ModelVersion {
  family: string;
  version: string;
  name: string;
  description: string;
  task: 'object-detection' | 'image-classification' | 'feature-classification' | 'image-encoder';
  adapter: 'ultralytics' | 'unsupported';
  classes: ModelClass[];
  input: JsonObject;
  evaluations: JsonObject[];
  caveats: string[];
  artifacts: ModelArtifact[];
  dependencies: string[];
  source_manifest?: string;
  /** Optional training/checkpoint creation timestamp supplied by the publisher. */
  created_at?: string;
}
export interface ModelCreationMetadata {
  date: string | null;
  source: 'publisher' | 'checkpoint' | 'legacy-manifest' | null;
  legacy_date: string | null;
  status: 'available' | 'not-recorded' | 'unavailable';
}
/** Read-only catalog metadata is separate from the immutable publishing payload. */
export interface ModelCatalogEntry extends ModelVersion {
  registered_at: string;
  creation: ModelCreationMetadata;
}
export interface ModelCatalog {
  models: ModelCatalogEntry[];
}
export interface ModelRow {
  family: string;
  version: string;
  manifest_json: string;
  created_at: string;
}
export interface ArtifactRow {
  sha256: string;
  bytes: number;
  object_key: string | null;
  chunks_json: string | null;
  created_at: string;
}
export interface ArtifactChunk {
  sha256: string;
  bytes: number;
}
export interface ModelParameters {
  imgsz: number;
  confidence: number;
  iou: number;
  device: 'auto' | 'cpu' | 'mps' | 'cuda';
}
export interface DeployedModel {
  slot: string;
  model: ModelVersion;
  artifact: ModelArtifact;
  parameters: ModelParameters;
}
export interface ModelDeployment {
  schema_version: 1;
  device_id: string;
  revision: string;
  models: DeployedModel[];
  created_at: string;
}
export interface ModelDevice {
  id: string;
  revision: string | null;
  deployment_json: string | null;
  updated_at: string;
  reported_revision: string | null;
  status: string;
  error: string | null;
  last_seen_at: string | null;
}
export type ModelDeviceDescription = Omit<ModelDevice, 'deployment_json'> & {
  deployment: ModelDeployment | null;
};
export interface ModelSelection {
  slot: string;
  family: string;
  version: string;
  sha256: string;
  parameters: ModelParameters;
}
export interface ArtifactDownload {
  body: ReadableStream<Uint8Array>;
  bytes: number;
  sha256: string;
}
