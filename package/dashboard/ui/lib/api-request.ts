/** Authenticated JSON transport shared by dashboard features. */
export async function apiRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw new Error('Sign in again to continue.');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value as T;
}
