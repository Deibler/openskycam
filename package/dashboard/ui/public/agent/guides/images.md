# Images and buckets

## Buckets

`buckets list` shows every bucket:

- `camera-archive` is the raw video (kind `raw`).
- Labeled buckets hold frames saved by runs, with counts of images, accepted, rejected, pending, and saved. `used_by` names the workflows that read or write each bucket.

`buckets create` needs a unique `name`. Use its `bucket_id` as an output step's `bucketId`. `buckets update` renames a bucket or changes its description, and needs `revision`. `buckets delete` previews first. Deleting a bucket removes its images, previews, and dataset versions, and cancels unfinished runs that read or write it. Workflows that use it keep their steps with an empty `bucketId` and must be pointed at another bucket before they run.

## Searching

`images search` returns newest first. Filters combine:

- `bucket_id`, `run_id`, `camera`
- `class`: at least one detection of that class (case-insensitive)
- `min_confidence`: at least one detection this confident (of `class`, if both are given)
- `status`: `pending`, `accepted`, or `rejected`
- `from` / `to` on the capture time

Each image has `image_id`, `captured_at`, `review`, `saved`, `expires_at`, and `detections`: a `count` and the `top` predictions as `{class, confidence, box}`. `box` is `[x1, y1, x2, y2]`, normalized 0–1 from the top-left. Page with `limit` and `next_offset`.

## Looking at images

`images view` with up to 4 `image_ids` shows each one downscaled (`size`, 768 px by default), with its detections. Sky objects are often only a few pixels across. To see one, pass `crop` as a box such as a detection's `box`, widened a little: `[x1-0.02, y1-0.02, x2+0.02, y2+0.02]`. For a test run's previews, also pass that `run_id`.

`images link` gives full-resolution download links.

## Reviewing and keeping

- `images review` with `image_ids` (up to 100) and `decision` (`accepted`, `rejected`, or `pending`) records a human-style review. Only accept what you have looked at and agree with.
- `images save` (up to 20) keeps images, labels, and provenance past their 40-day expiry. The source video is not kept.

## Datasets

`buckets create_version` with `bucket_id` and `name` freezes the bucket's accepted images. With `include_rejected: true` it also freezes images reviewed No. Each manifest item has `review` (`accepted` or `rejected`); a rejected item keeps the labels the reviewer rejected, which are not ground truth. Each image is assigned train/validation/test (80/10/10) by camera and capture day. `buckets versions` lists versions. `buckets export_version` gives the classes, split counts, and a manifest link. The manifest lists every image, label, and split. Its images download with `images link`.
