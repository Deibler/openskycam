-- Temporary run previews never participate in bucket membership or dataset versions.
ALTER TABLE workshop_jobs ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workshop_jobs ADD COLUMN expected_images INTEGER NOT NULL DEFAULT 0;
CREATE TABLE workshop_previews (
 job_id TEXT NOT NULL REFERENCES workshop_jobs(id), generation INTEGER NOT NULL,
 sequence INTEGER NOT NULL, item_id TEXT NOT NULL, item_json TEXT NOT NULL, expires_at TEXT NOT NULL,
 PRIMARY KEY(job_id,generation,sequence)
);
CREATE INDEX workshop_preview_expiry ON workshop_previews(expires_at);
CREATE INDEX workshop_preview_item ON workshop_previews(item_id);
