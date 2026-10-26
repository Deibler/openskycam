-- A D1 row holds at most 2 MB, roughly 1,200 manifest items, so each dataset version item gets its own row.
-- workshop_versions.manifest_json keeps the rest of the manifest; deleting a version deletes its items.
CREATE TABLE workshop_version_items (
 version_id TEXT NOT NULL REFERENCES workshop_versions(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, expires_at TEXT NOT NULL, item_json TEXT NOT NULL,
 PRIMARY KEY (version_id, position)
);
CREATE INDEX workshop_version_items_expiry ON workshop_version_items(expires_at);
CREATE TRIGGER workshop_version_item_immutable BEFORE UPDATE ON workshop_version_items BEGIN SELECT RAISE(ABORT,'Immutable dataset version'); END;
INSERT INTO workshop_version_items
SELECT v.id, j.key, json_extract(j.value, '$.expires_at'), j.value FROM workshop_versions v, json_each(v.manifest_json, '$.items') j;
