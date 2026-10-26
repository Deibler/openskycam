-- No pipeline is enabled by this migration. Registration/activation is explicit.
CREATE TABLE inference_pipelines (
  id TEXT PRIMARY KEY,
  model_sha256 TEXT NOT NULL CHECK(length(model_sha256) = 64),
  code_sha256 TEXT NOT NULL CHECK(length(code_sha256) = 64),
  config_sha256 TEXT NOT NULL CHECK(length(config_sha256) = 64),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  created_at TEXT NOT NULL
);
CREATE TRIGGER inference_pipeline_immutable BEFORE UPDATE ON inference_pipelines
BEGIN SELECT RAISE(ABORT, 'Register a new pipeline version instead.'); END;

CREATE TABLE inference_subscriptions (
  pipeline_id TEXT NOT NULL REFERENCES inference_pipelines(id),
  cam TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  PRIMARY KEY(pipeline_id, cam)
);

CREATE TABLE inference_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES inference_pipelines(id),
  object_key TEXT NOT NULL,
  cam TEXT NOT NULL,
  start TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','completed','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  result_sha256 TEXT,
  result_key TEXT,
  processed_seconds REAL,
  sampled_frames INTEGER,
  elapsed_seconds REAL,
  UNIQUE(pipeline_id, object_key, input_sha256)
);
CREATE INDEX inference_claim ON inference_jobs(pipeline_id, status, available_at, start);
CREATE INDEX inference_expiry ON inference_jobs(expires_at);

CREATE TABLE inference_events (
  job_id TEXT NOT NULL REFERENCES inference_jobs(id),
  track_id INTEGER NOT NULL,
  cam TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  label TEXT NOT NULL,
  score REAL NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(job_id, track_id)
);
CREATE INDEX inference_event_time ON inference_events(cam, start);

-- Ingest's segment INSERT and job creation commit together. Retry-safe by input + pipeline.
CREATE TRIGGER inference_segment_added AFTER INSERT ON segments
BEGIN
  INSERT OR IGNORE INTO inference_jobs
    (pipeline_id, object_key, cam, start, input_sha256, expires_at, available_at, created_at)
  SELECT pipeline_id, NEW.object_key, NEW.cam, NEW.start, NEW.sha256,
    strftime('%Y-%m-%dT%H:%M:%fZ', NEW.start, '+30 days'), NEW.uploaded_at, NEW.uploaded_at
  FROM inference_subscriptions WHERE cam = NEW.cam AND enabled = 1;
END;
