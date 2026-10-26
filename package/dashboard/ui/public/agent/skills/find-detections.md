# Skill: find and review detections

1. `buckets list`: find buckets with images, and note their `bucket_id` and counts.
2. `images search` with the filters that match the question. Examples:
   - Confident planes this week: `{"class":"Plane","min_confidence":0.6,"from":"2026-09-21T00:00:00Z"}`
   - Not yet reviewed, in one bucket: `{"bucket_id":"…","status":"pending"}`
   - Everything one run saved: `{"run_id":"…"}`

   Page with `offset` = `next_offset`.
3. `images view` with up to 4 `image_ids` to look. For small objects, pass one detection's `box`, widened by about 0.02 on each side, as `crop`.
4. Say what you see, and separate it from what the model claims: "The model says Plane 0.82; the crop shows an aircraft with navigation lights."
5. If the user asked you to review: `images review` with `decision` `accepted` for correct detections and `rejected` for wrong ones. Only decide on images you have viewed.
6. To keep images past 40 days: `images save`. To build a training set: `buckets create_version`, which uses accepted images only.
7. Verify: repeat the search with `status` set to your decision, and check that the images appear.
