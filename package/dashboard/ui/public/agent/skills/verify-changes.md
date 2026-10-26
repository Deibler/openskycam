# Skill: verify your changes

Report what you observed after the change, never what you attempted. A write that returned success is a claim; the read-back is the evidence.

| After you… | Verify by… |
| --- | --- |
| create or update a workflow | `workflows get`: steps, settings, and links are exactly what you intended, and `ready: true` (or the draft `issue` you expect). |
| change a footage window | `workflows check`: clip and frame counts are non-zero and within limits. |
| start a test or run | `runs watch` until `finished: true`. Then `status` is `completed`, `errors` is empty, and `images.processed` equals `images.expected`. |
| a run finished | `images search` with its `run_id` returns images. For a test, `images view` with its `run_id` shows previews. Look at a couple. |
| create or rename a bucket | `buckets list` shows it with the new name. |
| delete something | The list no longer contains it. Tell the user what the preview said was removed. |
| review or save images | `images search` with `status` shows the decision; `saved: true` after save. |
| schedule a workflow | `runs schedules` lists it with the trigger and time you set. After its time passes, `last_check` shows `started` (or why not). |
| take a photo | The image shows the sky at `captured_at`. |
| download a file | The file size matches `bytes`. |

Also:
- State sample sizes. "3 of 10 test frames had planes" is honest; "it works" is not.
- If a check fails, say so, show the evidence, and fix it or ask. Don't paper over it.
- A conflict error means someone else changed the Workshop. Read again before retrying; never retry blindly with a newer revision.
