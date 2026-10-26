-- Capture-time cursors keep large detection libraries responsive in either direction.
CREATE INDEX workshop_items_capture ON workshop_items(bucket_id,captured_at,id);
CREATE INDEX workshop_items_run_capture ON workshop_items(bucket_id,run_id,captured_at,id);
