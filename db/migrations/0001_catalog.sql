-- Catalog of stored segments. The ingest Worker writes a row for every segment it stores in R2;
-- the dashboard reads it. R2 stays the source of truth: rows past retention are pruned on insert,
-- matching the raw/ lifecycle rule.

CREATE TABLE segments (
  object_key  TEXT    PRIMARY KEY,   -- R2 object key
  cam         TEXT    NOT NULL,
  start       TEXT    NOT NULL,      -- ISO 8601 UTC, e.g. 2026-09-22T14:05:00.000Z
  day         TEXT    NOT NULL,      -- UTC date of start, YYYY-MM-DD
  size        INTEGER NOT NULL,      -- bytes
  duration_s  REAL,
  frames      INTEGER,
  width       INTEGER,
  height      INTEGER,
  bitrate     INTEGER,               -- bits per second, as measured by the relay
  codec       TEXT,
  sha256      TEXT    NOT NULL,
  uploaded_at TEXT    NOT NULL       -- ISO 8601 UTC
);

CREATE INDEX segments_by_cam_start ON segments (cam, start);
CREATE INDEX segments_by_cam_uploaded ON segments (cam, uploaded_at);

-- Per-camera, per-day totals kept current by the triggers below, so the dashboard's 30-day view
-- reads 30 rows instead of ~43,000.
CREATE TABLE daily_stats (
  cam      TEXT    NOT NULL,
  day      TEXT    NOT NULL,
  segments INTEGER NOT NULL DEFAULT 0,
  bytes    INTEGER NOT NULL DEFAULT 0,
  seconds  REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (cam, day)
);

CREATE TRIGGER segments_added AFTER INSERT ON segments
BEGIN
  INSERT INTO daily_stats (cam, day, segments, bytes, seconds)
  VALUES (NEW.cam, NEW.day, 1, NEW.size, COALESCE(NEW.duration_s, 0))
  ON CONFLICT (cam, day) DO UPDATE SET
    segments = segments + 1,
    bytes    = bytes + excluded.bytes,
    seconds  = seconds + excluded.seconds;
END;

CREATE TRIGGER segments_removed AFTER DELETE ON segments
BEGIN
  UPDATE daily_stats
     SET segments = segments - 1,
         bytes    = bytes - OLD.size,
         seconds  = seconds - COALESCE(OLD.duration_s, 0)
   WHERE cam = OLD.cam AND day = OLD.day;
  DELETE FROM daily_stats WHERE cam = OLD.cam AND day = OLD.day AND segments <= 0;
END;
