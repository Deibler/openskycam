import type {
  WorkshopAnnotation,
  WorkshopRecording,
  WorkshopRunImage,
  WorkshopTrack,
} from '../../../../src/models/workshopInferencemodel';
import type { PhotoMark, Sighting, SightingBatch, SightingClip, SightingState } from '../models/sightingInferencemodel';
import type { ReviewChange } from '../models/reviewInferencemodel';
import { inkOn } from './colorInferenceUtil';

export const labelsOf = (item: WorkshopRunImage) => JSON.parse(item.annotation_json) as WorkshopAnnotation[];
/** The tracks a photo's boxes belong to, by ID. Photos from before tracking have none. */
export const tracksOf = (item: WorkshopRunImage) =>
  new Map(((JSON.parse(item.provenance_json).tracks ?? []) as WorkshopTrack[]).map(track => [track.id, track]));
/**
 * How a box's object moved, in source pixels and seconds: "Moving · 26 px/s · 14 s". The full-rate figures win
 * when every frame was read; a duration that may run past the processed window ends in +.
 */
export function motionCaption(track: WorkshopTrack, height: number) {
  const scan = track.scan,
    speed = scan?.speed ?? track.speed,
    seen = scan?.first != null && scan.last != null ? scan.last - scan.first : track.end - track.start;
  const parts = [{ moving: 'Moving', stationary: 'Still', brief: 'Brief' }[track.motion]];
  if (speed != null && track.motion !== 'stationary') parts.push(`${Math.round(speed * height)} px/s`);
  if (scan && track.motion === 'brief') parts.push(`${scan.seen} ${scan.seen === 1 ? 'frame' : 'frames'}`);
  else if (seen > 0) parts.push(`${seen < 10 ? seen.toFixed(1) : Math.round(seen)} s${track.clipped ? '+' : ''}`);
  return parts.join(' · ');
}
export const topLabel = (item: WorkshopRunImage) =>
  labelsOf(item).reduce<WorkshopAnnotation | null>(
    (best, label) => (!best || label.confidence > best.confidence ? label : best),
    null,
  );
export const topBox = (item: WorkshopRunImage) =>
  labelsOf(item)
    .filter(label => label.box)
    .sort((a, b) => b.confidence - a.confidence)[0]?.box;

const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
const shared = (a: number[], b: number[]) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
/** Two boxes around one object: they share most of the smaller one. */
const covers = (a: number[], b: number[]) => shared(a, b) >= 0.6 * Math.min(area(a), area(b));
/**
 * Boxes drawn around one object more than once. A decision keeps one: the box of `prefer` when the
 * model drew one, else the tightest (the more confident of equal boxes), whatever its class.
 */
export function overlapped(labels: WorkshopAnnotation[], prefer?: string): number[] {
  const kept: number[] = [],
    dropped: number[] = [];
  const order = labels
    .flatMap((l, i) => (l.box ? [i] : []))
    .sort(
      (a, b) =>
        Number(labels[b].class_name === prefer) - Number(labels[a].class_name === prefer) ||
        area(labels[a].box!) - area(labels[b].box!) ||
        labels[b].confidence - labels[a].confidence,
    );
  for (const i of order) {
    if (kept.some(k => covers(labels[i].box!, labels[k].box!))) dropped.push(i);
    else kept.push(i);
  }
  return dropped.sort((a, b) => a - b);
}
/**
 * The labels a Yes saves for one photo of a sighting whose object is a `className`: one box per
 * object, that object's box named `className`. Undefined when they would not change.
 */
export function decidedLabels(item: WorkshopRunImage, className: string): WorkshopAnnotation[] | undefined {
  const labels = labelsOf(item),
    drop = overlapped(labels, className);
  const top = labels.reduce(
    (best, label, i) => (best < 0 || label.confidence > labels[best].confidence ? i : best),
    -1,
  );
  const kept = labels.flatMap((label, i) => (drop.includes(i) ? [] : [{ label, i }]));
  // The sighting follows the photo's top label: its box, or the one kept in its place.
  const object =
    top < 0
      ? -1
      : !drop.includes(top)
        ? top
        : (kept.find(k => k.label.box && covers(k.label.box, labels[top].box!))?.i ?? -1);
  const choice = modelClasses(item).find(c => c.name === className);
  const next = kept.map(({ label, i }) =>
    i === object && choice && label.class_name !== className
      ? { ...label, class_id: choice.id, class_name: className }
      : label,
  );
  return drop.length || next.some((label, i) => label !== kept[i].label) ? next : undefined;
}
/**
 * What saving a reviewer's marks does to a sighting's photos: a class is a Yes as that class, null a No,
 * and an unmarked photo a Yes as its sighting, unless `keepDecided` leaves an earlier choice alone.
 */
export function markedChanges(
  sighting: Sighting,
  marks: Record<string, PhotoMark>,
  keepDecided: boolean,
): ReviewChange[] {
  return sighting.frames.flatMap((f): ReviewChange[] => {
    const mark = marks[f.id];
    if (mark === undefined && keepDecided && f.review !== 'pending') return [];
    return [mark === null ? [f, 'rejected'] : [f, 'accepted', decidedLabels(f, mark ?? sightingClass(sighting))]];
  });
}
/** The changes that put saved photos back as they were. */
export const undoChanges = (changes: ReviewChange[]): ReviewChange[] =>
  changes.map(([f, review, labels]) => [
    { ...f, review, ...(labels ? { annotation_json: JSON.stringify(labels) } : {}) },
    f.review,
    labels && labelsOf(f),
  ]);
/** What a sighting's object is now: its first photo's top label, which a saved relabel changes. */
export const sightingClass = (sighting: Sighting) =>
  (sighting.frames[0] && topLabel(sighting.frames[0])?.class_name) || sighting.className;
/** The photo a sighting is best seen by: its most confident one. */
export const surestPhoto = (frames: WorkshopRunImage[]) =>
  frames.reduce(
    (best, f, i) => ((topLabel(f)?.confidence ?? 0) > (topLabel(frames[best])?.confidence ?? 0) ? i : best),
    0,
  );

const GAP_MS = 5000;
// On live runs 91% of a plane's steps between photos are within 3 of its widths, and 97% of wildlife
// "steps" (another bird, 5 s later) are further. A further jump is another object.
// ponytail: the first sighting in reach takes the photo, so two objects of one class passing within
// 3 widths of each other can swap; match each to the nearest if that shows up.
const STEP_WIDTHS = 3;
const centre = (b: number[]) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
/** Whether box `b` is close enough to `a` to be the same object a photo later; a photo without a box joins by time. */
function inReach(a: number[] | undefined, b: number[] | undefined) {
  if (!a || !b) return true;
  const [ax, ay] = centre(a),
    [bx, by] = centre(b);
  return Math.hypot(ax - bx, ay - by) <= STEP_WIDTHS * Math.max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1]);
}
/**
 * Groups a run's frames, oldest first, into sightings of one object each: same bucket and class, at
 * most 5 s apart, and the top box within reach of where the object last was.
 */
export function groupSightings(items: WorkshopRunImage[]): Sighting[] {
  const sorted = [...items].sort((a, b) => a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id));
  const open = new Map<string, Sighting[]>(),
    sightings: Sighting[] = [];
  for (const item of sorted) {
    const className = topLabel(item)?.class_name ?? 'No objects',
      key = `${item.bucket_id}\n${className}`,
      time = Date.parse(item.captured_at),
      box = topBox(item);
    const live = (open.get(key) ?? []).filter(s => time - Date.parse(s.frames.at(-1)!.captured_at) <= GAP_MS);
    open.set(key, live);
    const last = live.find(s => inReach(topBox(s.frames.at(-1)!), box));
    if (last) {
      last.frames.push(item);
      continue;
    }
    const sighting = { id: item.id, bucketId: item.bucket_id, className, frames: [item] };
    live.push(sighting);
    sightings.push(sighting);
  }
  return sightings;
}
export function sightingState(sighting: Sighting): SightingState {
  const reviews = new Set(sighting.frames.map(frame => frame.review));
  return reviews.has('pending') ? 'pending' : reviews.size === 1 ? ([...reviews][0] as SightingState) : 'mixed';
}
/** The next undecided sighting after `from` (never `from` itself), wrapping around; -1 when there is none. */
export function nextPending(sightings: Sighting[], from: number) {
  for (let step = 1; step <= sightings.length; step++) {
    const index = (from + step) % sightings.length;
    if (index !== from && sightingState(sightings[index]) === 'pending') return index;
  }
  return -1;
}

// ponytail: a video is the camera's UTC minute of a sighting's first photo, as the relay records them;
// read each sighting's recording if videos ever stop starting on the minute.
const videoOf = (sighting: Sighting) => `${sighting.frames[0].cam} ${sighting.frames[0].captured_at.slice(0, 16)}`;
/** About a screen of photos; a video with more is a batch by itself. */
export const BATCH_PHOTOS = 48;
/** Sightings in feed order as batches of whole videos, each batch about a screen of photos. */
export function batchSightings(sightings: Sighting[]): SightingBatch[] {
  const batches: SightingBatch[] = [];
  sightings.forEach((sighting, index) => {
    const batch = batches.at(-1),
      video = batch?.videos.at(-1),
      key = videoOf(sighting);
    if (video && videoOf(sightings[video.sightings[0]]) === key) video.sightings.push(index);
    else if (batch && batch.photos + videoPhotos(sightings, index, key) <= BATCH_PHOTOS)
      batch.videos.push({ start: sighting.frames[0].captured_at, sightings: [index] });
    else batches.push({ videos: [{ start: sighting.frames[0].captured_at, sightings: [index] }], photos: 0 });
    batches.at(-1)!.photos += sighting.frames.length;
  });
  return batches;
}
/** The photos of the video that starts with sightings[from]. */
function videoPhotos(sightings: Sighting[], from: number, key: string) {
  let photos = 0;
  for (let i = from; i < sightings.length && videoOf(sightings[i]) === key; i++) photos += sightings[i].frames.length;
  return photos;
}

/** The recording holding the sighting's first frame, looped from a second before its first frame to a second after its last. */
// ponytail: a sighting that crosses into the next recording loops only up to this recording's end.
export function sightingClip(sighting: Sighting, recordings: WorkshopRecording[]): SightingClip | null {
  const first = Date.parse(sighting.frames[0].captured_at),
    last = Date.parse(sighting.frames.at(-1)!.captured_at);
  const recording = recordings.find(
    r =>
      r.cam === sighting.frames[0].cam &&
      Date.parse(r.start) <= first &&
      first < Date.parse(r.start) + (r.duration_s ?? 60) * 1000,
  );
  if (!recording) return null;
  const start = Date.parse(recording.start),
    duration = recording.duration_s ?? 60;
  return {
    recording,
    from: Math.max(0, (first - start) / 1000 - 1),
    to: Math.min(duration, (last - start) / 1000 + 1),
  };
}
/** The top box moved in a straight line between the frames around `time` (ms), or null outside them. */
export function boxAt(frames: WorkshopRunImage[], time: number): number[] | null {
  const times = frames.map(frame => Date.parse(frame.captured_at));
  const after = times.findIndex(t => t >= time);
  if (after < 0 || (times[after] > time && after === 0)) return null;
  const end = topBox(frames[after]) ?? null;
  if (times[after] === time) return end;
  const start = topBox(frames[after - 1]) ?? null;
  if (!start || !end) return start ?? end;
  const k = (time - times[after - 1]) / (times[after] - times[after - 1]);
  return start.map((n, i) => n + (end[i] - n) * k);
}
/** The classes a frame's labels may use: its model's, which the server checks edits against. */
export const modelClasses = (item: WorkshopRunImage): { id: number; name: string }[] =>
  JSON.parse(item.provenance_json).annotation_model?.classes ?? [];
// Bright on a night sky and distinct from the green and red of Yes and No.
const palette = ['#ffd60a', '#64d2ff', '#ff9f0a', '#bf5af2', '#ff6482', '#7d7aff', '#66d4cf', '#ac8e68'];
export const classColor = (classId: number) => palette[Math.abs(classId) % palette.length];
/** Text on a class's color: whichever of black or white reads better (all of them black, at 5.9:1 or more). */
export const classInk = (classId: number) => inkOn(classColor(classId));
