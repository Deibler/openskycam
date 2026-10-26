-- Latest outcome of each workflow's schedule, so a skipped or failed trigger is visible in the editor.
-- Run history stays in workshop_runs; scheduled run IDs start with sched_.
CREATE TABLE workshop_schedules (
 workflow_id TEXT PRIMARY KEY,
 trigger_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('started','skipped','failed')),
 message TEXT NOT NULL,
 run_id TEXT,
 checked_at TEXT NOT NULL
);
