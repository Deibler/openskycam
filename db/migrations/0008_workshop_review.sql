-- Review screens read sightings by run and runs by workflow; without these each list scans every item.
CREATE INDEX workshop_items_run ON workshop_items(run_id,captured_at);
CREATE INDEX workshop_runs_workflow ON workshop_runs(workflow_id,created_at);
