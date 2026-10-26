import type { Env } from '../models/applicationSharedmodel';

/**
 * A JPEG from the footage store (external/store): a crop (pixels) enlarged or shrunk
 * to fit size x size, or the whole image only shrunk. Throws when the store fails.
 */
export async function thumbnail(
  env: Env,
  image: ReadableStream<Uint8Array>,
  size: number,
  crop?: { left: number; top: number; width: number; height: number },
) {
  const query = new URLSearchParams({ size: String(size) });
  for (const [name, value] of Object.entries(crop ?? {})) query.set(name, String(value));
  const response = await env.STORE.fetch(`http://store/thumbnail?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STORE_TOKEN}`, 'Content-Type': 'image/jpeg' },
    body: await new Response(image).arrayBuffer(),
  });
  if (!response.ok) throw new Error(`footage store answered ${response.status}: ${await response.text()}`);
  return response.arrayBuffer();
}

/** A small base64 JPEG for an agent to look at. A crop (pixels) is enlarged to `size`; a full frame is only shrunk. */
export async function agentPreview(
  env: Env,
  image: ReadableStream<Uint8Array>,
  size: number,
  crop?: { left: number; top: number; width: number; height: number },
) {
  const bytes = new Uint8Array(await thumbnail(env, image, size, crop));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
