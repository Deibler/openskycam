import type { JsonObject } from '../models/httpSharedmodel';
import type { ErrorCode } from '../models/errorSharedmodel';
import { ApplicationError } from './errorSharedUtil';
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApplicationError) {
    return json({ error: error.message }, HTTP_STATUS[error.code]);
  }
  console.error(error);
  return json({ error: 'internal error' }, 500);
}
export function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function requireSameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    throw new ApplicationError('forbidden', 'A same-origin website request is required.');
}

export async function readBody(request: Request, limit = 4096): Promise<JsonObject> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new ApplicationError('unsupported_media', 'Send application/json.');
  const bytes = await readBytes(request, limit, 'A JSON body is required.', 'Request body is too large.');
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as JsonObject;
  } catch {
    /* Return a predictable client error below. */
  }
  throw new ApplicationError('invalid_input', 'Provide a JSON object.');
}

export async function readBytes(
  request: Request,
  limit: number,
  missing: string,
  tooLarge: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError('invalid_input', missing);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ApplicationError('payload_too_large', tooLarge);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  length_required: 411,
  payload_too_large: 413,
  unsupported_media: 415,
  invalid_range: 416,
  invalid_data: 422,
  unavailable: 503,
};
