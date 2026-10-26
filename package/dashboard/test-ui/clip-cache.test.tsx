import { expect, it, vi } from 'vitest';
import { fragmentKeyframes, keepClips, cachedClip, clipPart, loadingClip } from '../ui/lib/clip-cache';

// --- A fragmented MP4 as the relay writes it: moov, then one moof per keyframe ---
function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0),
    out = new Uint8Array(size),
    view = new DataView(out.buffer);
  view.setUint32(0, size);
  out.set(
    [...type].map(c => c.charCodeAt(0)),
    4,
  );
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function words(...values: number[]) {
  const out = new Uint8Array(values.length * 4),
    view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}
function fragment(base: number) {
  const tfdt = new Uint8Array(12),
    view = new DataView(tfdt.buffer);
  view.setUint8(0, 1);
  view.setBigUint64(4, BigInt(base));
  return box('moof', box('traf', box('tfdt', tfdt)));
}
function mp4(...bases: number[]) {
  const parts = [
    box('ftyp', words(0)),
    box('moov', box('trak', box('mdia', box('mdhd', words(0, 0, 0, 90000, 0))))),
    ...bases.flatMap(b => [fragment(b), box('mdat', new Uint8Array(16))]),
  ];
  return new Blob(parts as BlobPart[]).arrayBuffer();
}
/** The same, ending with the fragment index (mfra) the relay writes: each keyframe's time and moof offset. */
async function indexed(...bases: number[]) {
  const body = new Uint8Array(await mp4(...bases)),
    offsets: number[] = [],
    view = new DataView(body.buffer);
  for (let at = 0; at < body.length; at += view.getUint32(at))
    if (String.fromCharCode(...body.slice(at + 4, at + 8)) === 'moof') offsets.push(at);
  const entries = new Uint8Array(bases.length * 19),
    ev = new DataView(entries.buffer);
  bases.forEach((b, i) => {
    ev.setBigUint64(i * 19, BigInt(b));
    ev.setBigUint64(i * 19 + 8, BigInt(offsets[i]));
    entries.set([1, 1, 1], i * 19 + 16);
  });
  const tfra = box('tfra', new Uint8Array([1, 0, 0, 0]), words(1, 0, bases.length), entries);
  const mfra = box('mfra', tfra, box('mfro', words(0, 8 + tfra.length + 16)));
  return { file: new Uint8Array(await new Blob([body, mfra] as BlobPart[]).arrayBuffer()), offsets };
}
/** A server answering one byte range, as the footage store does. */
function serve(file: Uint8Array, requests: string[]) {
  return vi.fn(async (_src: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range') ?? '',
      [, a, b] = /bytes=(\d*)-(\d*)/.exec(range)!;
    requests.push(range);
    const first = a === '' ? file.length - Number(b) : Number(a),
      last = a === '' || b === '' ? file.length - 1 : Math.min(file.length - 1, Number(b));
    return new Response(file.slice(first, last + 1), {
      status: 206,
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${first}-${last}/${file.length}` },
    });
  });
}

it('reads each fragment start as a keyframe time, and nothing from other files', async () => {
  expect(fragmentKeyframes(await mp4(0, 91260, 181260))).toEqual([0, 1.014, 2.014]);
  expect(fragmentKeyframes(new TextEncoder().encode('<html>Sign in</html>').buffer)).toEqual([]);
});

it('downloads wanted clips one at a time in order, keeps what a player uses, and retries failures', async () => {
  const body = await mp4(0, 90000);
  const order: string[] = [];
  let failNext = true;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: (b: Blob) => `blob:${b.size}-${order.length}`, revokeObjectURL: vi.fn() }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (src: string) => {
      order.push(src);
      if (src === '/c' && failNext) {
        failNext = false;
        throw new TypeError('offline');
      }
      return new Response(body, { headers: { 'Content-Type': 'video/mp4' } });
    }),
  );
  const ready = vi.fn();
  keepClips(['/a', '/b', '/c'], 5, ready);
  await vi.waitFor(() => expect(order).toEqual(['/a', '/b', '/c']));
  await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(3)); // after each, fetched or failed
  expect(cachedClip('/a')?.keyframes).toEqual([0, 1]);
  expect(cachedClip('/c')).toBeNull();
  cachedClip('/b'); // /a is now the least recently used, so only being in use can keep it
  keepClips(['/c'], 2, ready, ['/a']); // /c failed before, so it is fetched again; /b goes, /a is in use
  await vi.waitFor(() => expect(cachedClip('/c')).not.toBeNull());
  expect(cachedClip('/b')).toBeNull();
  expect(cachedClip('/a')).not.toBeNull();
  vi.unstubAllGlobals();
});

it("fetches only the fragments holding a sighting's seconds, timed from the first, and leaves other files to streaming", async () => {
  const { file, offsets } = await indexed(0, 90000, 180000, 270000),
    requests: string[] = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: (b: Blob) => `blob:${b.size}`, revokeObjectURL: vi.fn() }),
  );
  vi.stubGlobal('fetch', serve(file, requests));
  const settled = vi.fn(),
    part = clipPart('/part', 1.5, 2.2);
  keepClips([part], 5, settled);
  expect(loadingClip(part)).toBe(true);
  await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
  expect(requests).toEqual(['bytes=0-65535', 'bytes=-4096', `bytes=${offsets[1]}-${offsets[3] - 1}`]);
  expect(cachedClip(part)).toMatchObject({ offset: 1, keyframes: [0, 1] });
  expect(loadingClip(part)).toBe(false);

  vi.stubGlobal('fetch', serve(new Uint8Array(await mp4(0, 90000)), []));
  const plain = clipPart('/plain', 0, 1);
  keepClips([plain], 5, settled);
  await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(2));
  expect(cachedClip(plain)).toBeNull();
  expect(loadingClip(plain)).toBe(false);
  vi.unstubAllGlobals();
});

// A feed closed before its clip arrived must not leave the next feed's player waiting on it forever.
it('tells whoever wants a clip now when it arrives, not only whoever first asked for it', async () => {
  const body = await mp4(0, 90000);
  let release = () => {};
  const arrived = new Promise<void>(done => {
    release = done;
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:stale', revokeObjectURL: vi.fn() }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      await arrived;
      return new Response(body, { headers: { 'Content-Type': 'video/mp4' } });
    }),
  );
  const closed = vi.fn(),
    opened = vi.fn();
  keepClips(['/first-feed'], 5, closed);
  keepClips(['/first-feed'], 5, opened);
  release();
  await vi.waitFor(() => expect(cachedClip('/first-feed')).not.toBeNull());
  await vi.waitFor(() => expect(opened).toHaveBeenCalled());
});
it('downloads the clip wanted now before the ones wanted a moment ago', async () => {
  const body = await mp4(0, 90000),
    order: string[] = [];
  let release = () => {};
  const arrived = new Promise<void>(done => {
    release = done;
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: (b: Blob) => `blob:${b.size}`, revokeObjectURL: vi.fn() }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (src: string) => {
      order.push(src);
      await arrived;
      return new Response(body, { headers: { 'Content-Type': 'video/mp4' } });
    }),
  );
  keepClips(['/s1', '/s2', '/s3'], 5, vi.fn());
  await vi.waitFor(() => expect(order).toEqual(['/s1']));
  keepClips(['/s3', '/s4'], 5, vi.fn()); // a jump ahead: /s3 is on screen now
  release();
  await vi.waitFor(() => expect(order).toHaveLength(4));
  expect(order).toEqual(['/s1', '/s3', '/s4', '/s2']);
});
