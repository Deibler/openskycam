-- The model archive is durable. Device assignments pin immutable versions and bytes.
CREATE TABLE model_artifacts (
  sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  object_key TEXT,
  chunks_json TEXT,
  created_at TEXT NOT NULL,
  CHECK ((object_key IS NULL) != (chunks_json IS NULL))
);
CREATE TABLE model_versions (
  family TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (family, version)
);
CREATE TABLE model_devices (
  id TEXT PRIMARY KEY,
  revision TEXT,
  deployment_json TEXT,
  updated_at TEXT NOT NULL,
  reported_revision TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  last_seen_at TEXT
);
CREATE TABLE model_deployments (
  revision TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES model_devices(id),
  deployment_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
