-- Logical buckets reference canonical footage. This is independent of continuous inference.
CREATE TABLE workshop_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE workshop_runtimes (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, code_sha256 TEXT NOT NULL, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT);
CREATE TABLE workshop_runs (
 id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, workflow_id TEXT NOT NULL, name TEXT NOT NULL,
 runtime_id TEXT NOT NULL REFERENCES workshop_runtimes(id), snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE workshop_jobs (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workshop_runs(id), cam TEXT NOT NULL,
 input_json TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','completed','failed','expired','cancelled')),
 generation INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_owner TEXT, lease_until TEXT,
 result_sha256 TEXT, error TEXT, completed_at TEXT
);
CREATE INDEX workshop_job_queue ON workshop_jobs(status, lease_until);
CREATE INDEX workshop_job_run ON workshop_jobs(run_id);
CREATE TABLE workshop_uploads (object_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, generation INTEGER NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX workshop_upload_expiry ON workshop_uploads(expires_at);
CREATE TABLE workshop_items (
 id TEXT PRIMARY KEY, bucket_id TEXT NOT NULL, asset_id TEXT NOT NULL, run_id TEXT NOT NULL,
 job_id TEXT NOT NULL, source_sha256 TEXT NOT NULL, cam TEXT NOT NULL, captured_at TEXT NOT NULL,
 object_key TEXT NOT NULL, sha256 TEXT NOT NULL, expires_at TEXT NOT NULL, annotation_json TEXT NOT NULL,
 provenance_json TEXT NOT NULL, review TEXT NOT NULL DEFAULT 'pending' CHECK(review IN ('pending','accepted','rejected')),
 created_at TEXT NOT NULL
);
CREATE INDEX workshop_items_bucket ON workshop_items(bucket_id,created_at,id);
CREATE INDEX workshop_items_expiry ON workshop_items(expires_at);
CREATE TABLE workshop_versions (id TEXT PRIMARY KEY, bucket_id TEXT NOT NULL, name TEXT NOT NULL, manifest_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX workshop_versions_bucket ON workshop_versions(bucket_id,created_at);
CREATE TRIGGER workshop_runtime_immutable BEFORE UPDATE OF device_id,code_sha256,manifest_json ON workshop_runtimes BEGIN SELECT RAISE(ABORT,'Immutable runtime manifest'); END;
CREATE TRIGGER workshop_run_immutable BEFORE UPDATE ON workshop_runs BEGIN SELECT RAISE(ABORT,'Immutable run manifest'); END;
CREATE TRIGGER workshop_version_immutable BEFORE UPDATE ON workshop_versions BEGIN SELECT RAISE(ABORT,'Immutable dataset version'); END;
