export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
/** HMAC-SHA-256 of a message, as hex. */
export async function hmac(key: string, message: string): Promise<string> {
  const secret = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(message))));
}
