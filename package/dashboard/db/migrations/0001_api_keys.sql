-- Separate migration history and local development storage from the footage catalog.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  cameras TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  rotated_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_keys_by_owner ON api_keys(owner, created_at);
