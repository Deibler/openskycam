/**
 * Recordings held in memory ahead of playback, so the player never waits on the network when it
 * moves to the next clip, and fast speeds can jump between keyframes. A whole recording is ~30 MB;
 * a key made by `clipPart` holds only some of its seconds.
 */
/** `offset`: the recording's time, in seconds, at the copy's start. */
export interface CachedClip {
  url: string;
  keyframes: number[];
  offset: number;
}
interface Entry {
  clip: CachedClip | null;
  controller: AbortController;
  used: number;
  started: boolean;
}
interface Box {
  type: string;
  body: number;
  end: number;
}

const entries = new Map<string, Entry>();
// The clips wanted most recently, most urgent first, and whom to tell as each settles. Only the feed
// on screen asks, so the latest caller is the one waiting, even for a download an earlier feed began.
let urgent: string[] = [],
  notify = () => {},
  running = false;

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  for (let at = start; at + 8 <= end; ) {
    let size = view.getUint32(at),
      header = 8;
    if (size === 1 && at + 16 <= end) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) return;
    yield {
      type: String.fromCharCode(...new Uint8Array(view.buffer, at + 4, 4)),
      body: at + header,
      end: Math.min(at + size, end),
    };
    at += size;
  }
}
function find(view: DataView, start: number, end: number, path: string[]): Box | null {
  for (const box of boxes(view, start, end))
    if (box.type === path[0]) return path.length === 1 ? box : find(view, box.body, box.end, path.slice(1));
  return null;
}
function timescale(view: DataView, moov: Box) {
  const mdhd = find(view, moov.body, moov.end, ['trak', 'mdia', 'mdhd']);
  return mdhd ? view.getUint32(mdhd.body + (view.getUint8(mdhd.body) === 1 ? 20 : 12)) : 0;
}
const decodeTime = (view: DataView, tfdt: Box) =>
  view.getUint8(tfdt.body) === 1 ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4);

/**
 * Presentation times, in seconds, of each fragment's first frame. The relay writes one fragment
 * per keyframe (frag_keyframe), so these are the clip's keyframes. Empty for other layouts.
 */
export function fragmentKeyframes(buffer: ArrayBuffer): number[] {
  const view = new DataView(buffer),
    times: number[] = [];
  let scale = 0;
  for (const box of boxes(view, 0, buffer.byteLength)) {
    if (box.type === 'moov') scale = timescale(view, box);
    const tfdt = box.type === 'moof' && scale ? find(view, box.body, box.end, ['traf', 'tfdt']) : null;
    if (tfdt) times.push(decodeTime(view, tfdt) / scale);
  }
  return times;
}

/** The cache key for only `from`..`to` seconds of a recording. */
export const clipPart = (src: string, from: number, to: number) => `${src}#t=${from},${to}`;
const isVideo = (response: Response) => response.ok && !!response.headers.get('Content-Type')?.startsWith('video/');

/**
 * The fragments holding `from`..`to` seconds, behind the recording's header, with times moved to
 * start at the first: a few MB in two round trips. A player jumping into the recording instead reads
 * every fragment header one request at a time first (measured: 2.2 s against 6.6 s to the first
 * frame at 250 ms a request). Needs the fragment index (mfra) the relay writes last; null otherwise.
 */
async function part(
  src: string,
  from: number,
  to: number,
  signal: AbortSignal,
): Promise<{ buffer: ArrayBuffer; offset: number } | null> {
  const get = (range: string) =>
    fetch(src, { credentials: 'same-origin', signal, headers: { Range: `bytes=${range}` } });
  const [head, tail] = await Promise.all([get('0-65535'), get('-4096')]);
  const size = Number(tail.headers.get('Content-Range')?.split('/')[1]);
  if (!isVideo(head) || !isVideo(tail) || !size) return null;
  const start = new DataView(await head.arrayBuffer()),
    end = new DataView(await tail.arrayBuffer());
  const moov = [...boxes(start, 0, start.byteLength)].find(box => box.type === 'moov'),
    scale = moov ? timescale(start, moov) : 0;
  // mfra ends with mfro, whose last word is mfra's size.
  const indexSize = end.getUint32(end.byteLength - 4),
    mfra = indexSize <= end.byteLength ? [...boxes(end, end.byteLength - indexSize, end.byteLength)][0] : undefined;
  const tfra = mfra?.type === 'mfra' ? find(end, mfra.body, mfra.end, ['tfra']) : null;
  if (!moov || moov.end > start.byteLength || !scale || !tfra) return null;
  // tfra: version and flags, track, field sizes, count, then per keyframe its time, moof offset, and traf/trun/sample numbers.
  const wide = end.getUint8(tfra.body) === 1,
    sizes = end.getUint32(tfra.body + 8),
    step = (wide ? 16 : 8) + ((sizes >> 4) & 3) + ((sizes >> 2) & 3) + (sizes & 3) + 3;
  const keys = Array.from({ length: end.getUint32(tfra.body + 12) }, (_, i) => {
    const at = tfra.body + 16 + i * step;
    return wide
      ? { time: Number(end.getBigUint64(at)), offset: Number(end.getBigUint64(at + 8)) }
      : { time: end.getUint32(at), offset: end.getUint32(at + 4) };
  });
  const first = keys.filter(k => k.time <= from * scale).at(-1) ?? keys[0];
  if (!first) return null;
  const next = keys.find(k => k.offset > first.offset && k.time > to * scale);
  const media = await get(`${first.offset}-${(next?.offset ?? size - indexSize) - 1}`);
  if (!isVideo(media)) return null;
  const fragments = new Uint8Array(await media.arrayBuffer()),
    out = new Uint8Array(moov.end + fragments.length),
    view = new DataView(out.buffer);
  out.set(new Uint8Array(start.buffer, 0, moov.end));
  out.set(fragments, moov.end);
  for (const moof of boxes(view, moov.end, out.length)) {
    const tfdt = moof.type === 'moof' ? find(view, moof.body, moof.end, ['traf', 'tfdt']) : null;
    if (tfdt && view.getUint8(tfdt.body) === 1)
      view.setBigUint64(tfdt.body + 4, BigInt(decodeTime(view, tfdt) - first.time));
    else if (tfdt) view.setUint32(tfdt.body + 4, decodeTime(view, tfdt) - first.time);
  }
  return { buffer: out.buffer, offset: first.time / scale };
}

async function download(key: string, entry: Entry) {
  if (entry.controller.signal.aborted) return;
  const [src, seconds] = key.split('#t='),
    [from, to] = seconds?.split(',').map(Number) ?? [];
  try {
    let copy: { buffer: ArrayBuffer; offset: number } | null = null;
    if (seconds) copy = await part(src, from, to, entry.controller.signal);
    else {
      const response = await fetch(src, { credentials: 'same-origin', signal: entry.controller.signal });
      // An expired sign-in answers with a page, not video: leave that clip to the network path.
      if (isVideo(response)) copy = { buffer: await response.arrayBuffer(), offset: 0 };
    }
    const keyframes = copy ? fragmentKeyframes(copy.buffer) : [];
    if (!copy || !keyframes.length || entry.controller.signal.aborted) return;
    entry.clip = {
      url: URL.createObjectURL(new Blob([copy.buffer], { type: 'video/mp4' })),
      keyframes,
      offset: copy.offset,
    };
  } catch {
    /* Offline or cancelled: playback streams from the network instead. */
  }
}

/** Whether `src` is still downloading, so a player can wait for it rather than fetch the same video again. */
export const loadingClip = (src: string) => entries.get(src)?.clip === null;

/** A clip already in memory, or null while it downloads (or if it could not be). */
export function cachedClip(src: string): CachedClip | null {
  const entry = entries.get(src);
  if (entry) entry.used = performance.now();
  return entry?.clip ?? null;
}

/** Downloads one clip at a time, always the most urgent of those still waiting. */
async function run() {
  if (running) return;
  running = true;
  const waiting = (src: string) => entries.get(src)?.started === false;
  for (;;) {
    const src = urgent.find(waiting) ?? [...entries.keys()].find(waiting);
    if (!src) break;
    const entry = entries.get(src)!;
    entry.started = true;
    await download(src, entry);
    if (entries.get(src) !== entry) continue;
    if (!entry.clip) entries.delete(src); // try again next time it is wanted
    notify();
  }
  running = false;
}

/**
 * Keep `wanted` in memory, most urgent first, and let go of the least recently used others beyond
 * `limit`, except those `inUse`. Downloads run one at a time, the latest call's most urgent first;
 * that call's `onSettle` follows each, fetched or failed.
 */
export function keepClips(wanted: string[], limit: number, onSettle: () => void, inUse: string[] = []) {
  urgent = wanted.slice(0, limit);
  notify = onSettle;
  for (const src of urgent)
    if (!entries.has(src))
      entries.set(src, { clip: null, controller: new AbortController(), used: performance.now(), started: false });
  // A copy a player is using is never released from under it.
  const others = [...entries]
    .filter(([src]) => !wanted.includes(src) && !inUse.includes(src))
    .sort((a, b) => a[1].used - b[1].used);
  while (entries.size > limit && others.length) {
    const [src, entry] = others.shift()!;
    entry.controller.abort();
    if (entry.clip) URL.revokeObjectURL(entry.clip.url);
    entries.delete(src);
  }
  void run();
}
