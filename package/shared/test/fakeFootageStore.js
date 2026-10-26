// Stands in for external/store (the footage store) in Worker tests: the same routes,
// status codes and headers, backed by a local R2 bucket. Bound as STORE by each vitest.config.ts,
// which gives it TOKEN and BLOBS.
export default {
  async fetch(request, env) {
    if (request.headers.get('Authorization') !== `Bearer ${env.TOKEN}`) {
      return reply(401, { error: 'unauthorized' });
    }
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/thumbnail') return thumbnail(url, request);
    const key = url.pathname.replace(/^\/o\//, '');
    return request.method === 'PUT' ? put(env.BLOBS, key, request) : read(env.BLOBS, key, request);
  },
};

async function put(bucket, key, request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const sha256 = request.headers.get('X-Sha256');
  const existing = await bucket.head(key);
  if (existing) {
    return existing.customMetadata.sha256 === sha256
      ? reply(200, { size: existing.size })
      : reply(409, { error: 'a different recording already exists at this key' });
  }
  if ((await hex(bytes)) !== sha256) return reply(422, { error: 'body does not match X-Sha256' });
  await bucket.put(key, bytes, { customMetadata: { sha256 } });
  return reply(201, { size: bytes.byteLength });
}

async function read(bucket, key, request) {
  const object = await bucket.head(key);
  if (!object) return reply(404, { error: 'no recording at this key' });
  const size = object.size;
  const header = request.method === 'GET' ? request.headers.get('Range') : null;
  const span = header ? parseRange(header, size) : null;
  if (span === 'unsatisfiable') {
    return reply(416, { error: 'requested range is not satisfiable' }, { 'Content-Range': `bytes */${size}` });
  }
  const [first, last] = span ?? [0, size - 1];
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: `"${object.etag}"` };
  if (span) headers['Content-Range'] = `bytes ${first}-${last}/${size}`;
  headers['Content-Length'] = String(last - first + 1);
  if (request.method === 'HEAD') return new Response(null, { headers });
  const body = await bucket.get(key, { range: { offset: first, length: last - first + 1 } });
  return new Response(body.body, { status: span ? 206 : 200, headers });
}

// Cannot resize here: answers with the query it was asked for, so tests can check the crop.
async function thumbnail(url, request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return reply(422, { error: 'not a readable image' });
  return new Response(`thumbnail${url.search}`, { headers: { 'Content-Type': 'image/jpeg' } });
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    return suffix && size ? [Math.max(0, size - suffix), size - 1] : 'unsatisfiable';
  }
  const first = Number(match[1]);
  const last = match[2] ? Number(match[2]) : size - 1;
  return first >= size || last < first ? 'unsatisfiable' : [first, Math.min(last, size - 1)];
}

function reply(status, body, headers = {}) {
  return Response.json(body, { status, headers });
}

async function hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
