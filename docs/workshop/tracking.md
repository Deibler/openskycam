---
title: Tracking and trajectories
description: How the processor links boxes into tracks across a recording, decides whether each object moves, follows it through every frame, and stores the result.
---

A detector looks at one frame at a time, so a star, a planet or a tower light looks like a plane to it, and a meteor that lasts a third of a second is usually between two samples. The processor therefore links each detection model's boxes across a whole recording into **tracks**, one per object. It decides whether each object moves, and in **Most change** runs it follows the saved objects through every frame. Conditions can route on the result, and the tracks are stored with every saved image so a later model can learn from trajectories as well as pixels.

The code is in [`trajectoryInferenceService.py`](https://github.com/Deibler/openskycam/blob/main/processor/skyvision_processor/service/trajectoryInferenceService.py) and [`workshopInferenceService.py`](https://github.com/Deibler/openskycam/blob/main/processor/skyvision_processor/service/workshopInferenceService.py). Every `workshop-v3` runtime tracks every video job; a workflow that keeps frames by Most change or routes on motion is refused on a runtime without the `tracking` capability ([Runs](runs.md)).

## Why

Measured on the reference camera (4K, about 8 frames per second):

- **Sampling misses meteors.** A meteor spans about three frames. Sampling one frame per second landed on about a quarter of them: 21–31% of 36 meteors measured in full-rate footage.
- **Fixed lights pass as planes.** A night detector at a useful threshold labels some stars and fixed lights as planes. In one frame there is nothing to tell them apart; across a minute, one moves and the other does not.

## Units

Positions are fractions of the frame (0–1). Distances and speeds are in **frame heights**, with x scaled by the frame's aspect ratio, so they do not depend on resolution. A speed of 0.01 means a hundredth of the frame's height per second: 21.6 px/s on a 2160-row frame.

The linking gates below are calibrated on reviewed night footage from that camera. Confirmed planes have a median box of 0.017 frame heights (36 of 2,160 px). Across 3,921 plane steps between frames, the median speed was 0.012 frame heights per second and the 99.9th percentile 0.054.

## Linking boxes into tracks

After a detection model has labeled every sampled frame of a recording that reached it, the processor links that model's boxes, frame by frame in time order, before any condition reads them. Classifier labels have no box and are not tracked.

For each frame, every live track predicts where its object should be, with a gate around that point:

| Track so far | Predicted position | Gate radius |
| --- | --- | --- |
| One detection | Where it was | `min(0.1, max(1.5 × size, 0.008) + 0.06 × dt)` |
| Two or more | A least-squares line through its last six detections | `max(size, 0.006) + (0.25 × speed + 0.003) × dt` |

`size` is the median of the track's recent box sizes and `dt` the seconds since its last detection. A track is live while it has been seen in the last **5 s**, which carries it through missed detections and blinking strobes.

Each box is scored against every live track whose gate contains it: the distance divided by the gate radius, plus 0.5 when the classes differ, so a same-class track wins a tie. Pairs are assigned greedily from the lowest score, one box per track. A box that matches no track starts a new one. Crossing planes keep their own tracks, and so does a plane passing a star, as the tests check.

Tracks are numbered in order of their first detection, and each box gets its track's ID in `track_id`. Tracks stop at the recording's boundary, so an object that crosses two one-minute recordings has two tracks.

## Moving, stationary or brief

Each track gets one **motion** verdict from all its detections:

1. Fit a least-squares velocity through every detection's centre. `speed` is its magnitude.
2. Estimate the uncertainty of that speed. The scatter is the largest of the fit's residual RMS, 5% of the median box size (how much a box centre jitters between frames) and 0.0003. The error is `2 × scatter / √Σ(t − t̄)²`, so it shrinks as the track lasts longer.
3. Compare with **`STILL` = 0.002** frame heights per second (a star drifts about 0.0001):

| Verdict | When |
| --- | --- |
| `stationary` | `speed + error < 0.002` |
| `moving` | `speed − error > 0.002` |
| `brief` | Anything in between: a single detection, or too few and too close in time to tell |

`brief` is a statement about evidence, not about the object: a meteor seen in one sample is `brief`, and so is a plane seen twice a second apart. Replayed over 8,173 reviewed frames, the tracker called none of 4,800 confirmed planes `stationary`, and called 69% of rejected plane boxes `stationary`.

## Routing on motion

A `motion` rule in a condition ([Workflows](workflows.md)) matches when **at least one box of the rule's class has that motion**. A box with no track counts as `brief`; that includes every box of a labeled-bucket input, where there is no recording to link across.

Because of "at least one box", a frame with a moving plane and a fixed light matches both `moving` and `stationary`. To keep planes and set fixed lights aside:

1. Add a condition with `match: any` and two motion rules for the class: `moving` and `brief`.
2. Send `yes` to the bucket you keep. Send `no` to a fixed-lights bucket: it only receives frames in which every box of the class stayed still, or frames with no box of the class at all.

Routing on `stationary` alone would send the frame with a plane and a star to the fixed-lights bucket.

## Most change: keeping the frame with new light

With the footage step's **Frame kept** set to Most change (`pick: "change"`), the processor decodes every frame of the recording, and keeps per sample slot the frame with the most **new light**:

1. Convert each frame to grey at quarter size.
2. Take the per-pixel maximum of the previous **8** frames (about 1 s) as the reference.
3. Subtract the reference, blur 3×3, and take the brightest remaining pixel outside the recurring-light mask. That value is the frame's score.

Stars and slow planes are already in the reference, so they cancel. A meteor, a satellite flare or a strobe flash stands out.

### The recurring-light mask

On the reference camera, the burned-in clock changes every second and won "most new light" in most slots, hiding fainter meteors. Light that keeps coming back to the same pixels is masked:

| Constant | Value | Meaning |
| --- | --- | --- |
| `REPEAT_LIGHT` | 10 | Grey levels of new light that count as a hit |
| `REPEAT_DECAY` | 0.995 per frame | Each pixel's hit count halves in about 16 s |
| `REPEAT_LIMIT` | 1.5 | A count this high (hits twice within a few seconds) marks the pixel as recurring |
| `REPEAT_REACH` | 20 quarter-size px | Margin masked around recurring pixels: 80 px at 4K, a few characters of text |

The mask also covers a fixed blinker. A tens digit that changes every 10 s would never repeat often enough on its own; the margin around the recurring digits next to it covers it. The mask the scan ends with is reused when following tracks, below.

## Following tracks at full rate

In Most change runs only, after the model passes and conditions, the processor follows each track of a **saved** frame through every decoded frame, in one extra pass over the recording. The pass covers 2.5 s before the earliest detection to 2.5 s after the latest. Stationary tracks are not followed: they stay where their detections are. In every frame, recurring-light pixels are blanked to black.

| Track | How it is followed |
| --- | --- |
| `moving` | From 1 s before its first detection to 1 s after its last, at the position its detections interpolate to (or extrapolate from its nearest four). The background is the maximum of two frames far enough before and after that the object has left its own pixels (2–8 frames). The search radius is `min(0.08, max(2 × size, 0.01) + 0.3 × speed × gap)`. |
| `brief` | From its most confident detection, outward both ways one frame at a time, predicting each next position from the positions found so far, until two frames in a row show nothing or the ±8-frame window ends. The search radius is `min(0.15, max(2.5 × size, 0.03))`. |

In each frame the processor looks for new light near the predicted point. It subtracts the background and takes the median as the level. The noise is 1.4826 × the median absolute deviation, plus 0.5. A Gaussian weighting favours the prediction. The object counts as **seen** when its peak is at least 6 grey levels and at least 5 times the noise. The position is then re-centred four times on the light's own centroid, so a streak cut off by the search window still lands on its middle.

The result is a `scan` on each track record: how many frames were searched and how many saw the object, the first and last visible time, and a speed fitted through the visible positions. It also keeps the per-frame samples within 2 s of the saved image. A meteor that the 1-second samples saw once becomes a measured streak with a duration and a speed.

## Stored records

Each saved image's provenance has a `tracks` list with one record per track that has a box in the image. Each such box names its track in `track_id`.

| Field | Meaning |
| --- | --- |
| `id` | `<job id>:<n>`, `n` from 1, in order of first detection |
| `motion` | `moving`, `stationary` or `brief` |
| `speed` | Least-squares speed in frame heights per second; `null` for a single detection |
| `start`, `end` | First and last detection, in seconds into the recording |
| `detections` | Number of detections, the length of `path` |
| `clipped` | `["start"]`, `["end"]` or both, when the track's first detection is within 1.5 sample spacings of the first frame the model labeled in this recording (or its last that close to the last frame), so the object may extend past what was processed |
| `path` | Every detection: `[t, x, y, width, height, class_id, confidence]`, positions and sizes as fractions of the frame |
| `scan` | Most change runs only: `fps`, frames `searched` and `seen`, `speed` (frame heights per second, null below two visible positions), `first` and `last` visible time, and `samples` `[t, x, y, peak]` within 2 s of this image, with `x` and `y` null in frames where it was not seen |

An example record, shortened (`"…"` marks omitted entries):

```json
{
  "id": "night_12_0:3",
  "motion": "moving",
  "speed": 0.011842,
  "start": 4.0, "end": 39.0, "detections": 31,
  "path": [[4.0, 0.41213, 0.22918, 0.00811, 0.01422, 0, 0.6123], ["…"]],
  "scan": { "fps": 8.392, "searched": 302, "seen": 288, "speed": 0.011907, "first": 3.112, "last": 39.876,
            "samples": [[11.004, 0.4382, 0.2105, 21.4], [11.123, null, null, 0.0], ["…"]] }
}
```

Dataset versions export `tracks` and `track_id` unchanged ([Buckets and datasets](datasets.md)). A reviewer's edit keeps a box's `track_id`, and clients cannot set it.

### What the server accepts

The server checks every track the processor sends and refuses the whole result if one is malformed:

- At most 1,000 tracks per frame, and at most 512 KB of track JSON per frame.
- Each `id` is the job's ID, a colon and 1–999,999, unique in the frame. Every track must have a box in the frame naming it, and every `track_id` must name one of the frame's tracks.
- Each `path` has 1–4,000 entries, equal to `detections`. Each entry's times are inside the recording (plus 5 s) and its positions are fractions.
- `motion` is one of the three verdicts and `speed` is null or non-negative.
- In a `scan`, `seen` is at most `searched`, and there are at most 600 samples.
- Photos and labeled-bucket inputs carry no tracks.

## Limits

- Tracks cover one recording. A crossing that spans two recordings is two tracks.
- Each detection model's boxes are linked separately, and each model's pass continues the job's track numbers, so an `id` names one object across the whole job. Runtimes registered before this change numbered each model's pass from 1, so two detection models in one workflow could reuse an `id`; join such tracks on the `id` and the frame's `annotation_model`.
- Motion is decided from the sampled frames. A track's `speed` comes from detections at the sample interval; the `scan` speed, when present, comes from every frame.
- Full-rate following runs only for frames that reach an output, only in Most change runs, and only for moving and brief tracks.
