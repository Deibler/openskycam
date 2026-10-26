-- Rebuild to extend the original scope CHECK without changing existing secrets.
CREATE TABLE api_keys_next (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
  secret_hash TEXT NOT NULL, prefix TEXT NOT NULL, cameras TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  last_used_at TEXT, rotated_at TEXT, revoked_at TEXT,
  scope TEXT NOT NULL DEFAULT 'footage:read'
    CHECK(scope IN ('footage:read','processor:run','models:write','models:sync')),
  pipeline_id TEXT, device_id TEXT
);
INSERT INTO api_keys_next SELECT *, NULL FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_next RENAME TO api_keys;
CREATE INDEX api_keys_by_owner ON api_keys(owner, created_at);
