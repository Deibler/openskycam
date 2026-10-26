---
title: Catalog and storage layout
sidebar: Catalog
description: What the D1 catalog holds, how footage is laid out on disk and in R2, and how to query the catalog yourself.
---

openskycam keeps metadata in one Cloudflare D1 database, `skyvision-catalog`, and bytes in three places:

- footage on the [store host's disk](store.md);
- model files in the R2 bucket `skyvision-models`;
- Workshop images in the R2 bucket `skyvision-workshop`.

The database is the index: what was recorded, what was found in it, and who may read it. Both Workers bind it as `CATALOG`, and the dashboard also binds it as `API_KEYS`.

## Migrations

The schema is two migration histories in the same database. `npm run release` in `package/dashboard/` applies both before every deploy:

| Directory | Tables | History table |
|---|---|---|
| [`db/migrations/`](https://github.com/Deibler/openskycam/blob/main/db/migrations/) | Footage, Workshop, models, continuous inference | `d1_migrations` (Wrangler's default) |
| [`package/dashboard/db/migrations/`](https://github.com/Deibler/openskycam/blob/main/package/dashboard/db/migrations/) | API keys | `api_key_migrations` |

Changes are new files only. A deployment never runs a migration it has already applied, so editing an applied file changes nothing for existing catalogs. A new catalog starts with no models, workflows or keys.

## Footage

| Table | One row per | Key columns |
|---|---|---|
| `segments` | Stored one-minute recording | `object_key` (primary key), `cam`, `start` (ISO 8601 UTC), `day` (UTC date of `start`), `size` (bytes), `duration_s`, `frames`, `width`, `height`, `bitrate` (bits per second, measured by the relay), `codec`, `sha256`, `uploaded_at` |
| `daily_stats` | Camera and UTC day | `segments`, `bytes`, `seconds` |

The [ingest Worker](ingest.md) writes `segments` and deletes that camera's rows older than 40 days in the same batch. Metadata columns are `NULL` when the relay did not send them.

`daily_stats` is maintained by two triggers on `segments`. Each insert adds to its day, and each delete subtracts and removes the day once it has no segments. The Activity view and the 40-day chart read 40 rows instead of up to 57,600 (1,440 a day). Days without footage have no row, and the website fills them with zeros.

Indexes on `(cam, start)` and `(cam, uploaded_at)` serve time queries and the newest-upload health check.

## Workshop

| Table | Holds |
|---|---|
| `workshop_state` | One row (`id = 1`): the whole Workshop document, its workflows and buckets, as JSON, with a `revision` that every save must match |
| `workshop_runtimes` | Registered processor runtimes: device, code SHA-256, manifest, `last_seen_at` |
| `workshop_runs` | One run of a workflow, with the frozen snapshot of everything it needs |
| `workshop_jobs` | One recording (or image) of a run: `status` (`queued`, `leased`, `completed`, `failed`, `expired`, `cancelled`), lease `generation`, `lease_token`, `lease_until`, `progress_json` |
| `workshop_uploads` | Every image object a job wrote to R2, with its expiry, so cleanup can delete it |
| `workshop_items` | One labeled image in a bucket: camera, `captured_at`, R2 `object_key`, `sha256`, `annotation_json` (boxes and labels, including track IDs), `provenance_json`, `review` (`pending`, `accepted`, `rejected`), `expires_at` |
| `workshop_previews` | Test-run frames and photos, temporary, never part of a bucket |
| `workshop_versions` | A frozen dataset version of a bucket: name, manifest, manifest SHA-256 |
| `workshop_version_items` | The version's items, one row each, because a D1 row holds at most 2 MB (about 1,200 items) |
| `workshop_schedules` | The latest outcome of each workflow's schedule (`started`, `skipped`, `failed`), so a skipped trigger is visible |

The [Workshop pages](../workshop/workflows.md) explain what these mean in use.

## Models

| Table | Holds |
|---|---|
| `model_artifacts` | One model file by SHA-256: its size, and either one R2 `object_key` or a `chunks_json` list of parts (a check constraint requires exactly one) |
| `model_versions` | One published version, `(family, version)`, with its manifest: task, classes, input size, files, evaluations |
| `model_devices` | A processor device and the deployment it should run and last reported |
| `model_deployments` | Every deployment revision ever assigned to a device |

See [Models](../models.md).

## Continuous inference (preview)

`inference_pipelines`, `inference_subscriptions`, `inference_jobs` and `inference_events` belong to a continuous-inference integration that is off by default. A trigger on `segments` queues a job for each new recording of a camera with an enabled subscription. The job expires 40 days after the recording starts. Nothing is queued while no subscription is enabled.

## API keys

`api_keys` holds one row per key:

- `owner` (the signed-in email) and `name`;
- `scope`, one of `footage:read`, `processor:run`, `models:write`, `models:sync`, `workshop:run` or `agent`;
- `cameras` (a JSON list), and `pipeline_id` or `device_id` for keys bound to one;
- `created_at`, `expires_at`, `last_used_at`, `rotated_at` and `revoked_at`.

Only a SHA-256 hash of each secret is stored, with a display `prefix`. See [API overview](../api.md).

## What cannot change

Triggers make these rows immutable: an `UPDATE` aborts. A changed thing gets a new row instead.

| Trigger | Protects |
|---|---|
| `workshop_runtime_immutable` | A runtime's device, code hash and manifest |
| `workshop_run_immutable` | A run and its snapshot |
| `workshop_version_immutable`, `workshop_version_item_immutable` | Dataset versions and their items |
| `inference_pipeline_immutable` | A registered inference pipeline |

Deleting a dataset version deletes its items (`ON DELETE CASCADE`).

## Expiry and cleanup

Workshop images, items and previews carry an `expires_at`. Reads ignore expired rows. The dashboard's cron runs every minute, and on every 15th minute it deletes expired R2 objects listed in `workshop_uploads`, then expired labels. Saving an image copies it under `retained/` and sets its `expires_at` to `9999-12-31`. The image, labels and provenance are kept for good; the source recording still expires with the footage.

## Footage on disk

```
<footage-root>/raw/cam=<cam>/date=<YYYY-MM-DD>/hour=<HH>/<cam>_<YYYYMMDDTHHMMSSZ>.mp4
```

- All times are UTC, so there are no duplicate or missing hours at daylight-saving changes. The file name is the segment's start.
- The `key=value` folders are Hive-style partitions. DuckDB, Spark, pyarrow and Hugging Face `datasets` can filter by camera, date and hour without listing every file.
- A camera that records all day makes 1,440 files a day in 24 hour folders.
- `<footage-root>/.incoming/` holds uploads in progress and is never served.

The catalog's `object_key` is the same path without `<footage-root>/`. To read footage elsewhere, download it through the [footage API](../api/footage.md) rather than copying files off the store.

## R2 buckets

| Bucket | Keys |
|---|---|
| `skyvision-models` | `chunks/sha256/<sha256>`: parts of model files, joined on download and checked against the file's SHA-256 |
| `skyvision-workshop` | `workshop/<expiry>/<sha256>.jpg` run images · `workshop-tests/<job>/<sha256>.jpg` test-run frames · `retained/<uuid>/<sha256>.jpg` saved images · `thumbnails/<item>/<mode>-<size>.jpg` cached thumbnails |

## Query the catalog

Run `wrangler` from the repository root through `npm run wrangler`. Inside a Worker folder, `wrangler` refuses the incomplete `wrangler.jsonc`.

```sh
# The last week for one camera: segments, GB and hours recorded per day
npm run wrangler -- d1 execute skyvision-catalog --remote --command \
  "SELECT day, segments, round(bytes / 1e9, 1) AS gb, round(seconds / 3600.0, 1) AS hours
   FROM daily_stats WHERE cam = 'sky01' ORDER BY day DESC LIMIT 7"

# Minutes recorded in each hour of one UTC day, to find gaps
npm run wrangler -- d1 execute skyvision-catalog --remote --command \
  "SELECT substr(start, 12, 2) AS hour, count(*) AS minutes
   FROM segments WHERE cam = 'sky01' AND day = '2026-09-22' GROUP BY hour ORDER BY hour"

# Labeled images per bucket and review state
npm run wrangler -- d1 execute skyvision-catalog --remote --command \
  "SELECT bucket_id, review, count(*) FROM workshop_items
   WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') GROUP BY bucket_id, review"
```

Add `--json` for machine-readable output. Treat these as read-only. A write bypasses the Workers' validation, and the triggers above refuse most edits anyway. To change data, use the website or the [API](../api.md).
