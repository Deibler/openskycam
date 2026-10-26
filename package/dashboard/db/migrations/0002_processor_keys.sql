ALTER TABLE api_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'footage:read'
  CHECK(scope IN ('footage:read','processor:run'));
ALTER TABLE api_keys ADD COLUMN pipeline_id TEXT;
