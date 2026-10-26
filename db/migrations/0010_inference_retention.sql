-- Footage retention is 40 days (RETENTION_DAYS in package/shared/src/utils/layoutStorageUtil.ts);
-- inference jobs expire with their recording.
DROP TRIGGER inference_segment_added;
CREATE TRIGGER inference_segment_added AFTER INSERT ON segments
BEGIN
  INSERT OR IGNORE INTO inference_jobs
    (pipeline_id, object_key, cam, start, input_sha256, expires_at, available_at, created_at)
  SELECT pipeline_id, NEW.object_key, NEW.cam, NEW.start, NEW.sha256,
    strftime('%Y-%m-%dT%H:%M:%fZ', NEW.start, '+40 days'), NEW.uploaded_at, NEW.uploaded_at
  FROM inference_subscriptions WHERE cam = NEW.cam AND enabled = 1;
END;
