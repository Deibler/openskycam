/** Immutable, content-addressed evidence; retention remains tied to the source event. */
export async function writeEvidence(
  bucket: R2Bucket,
  key: string,
  data: Uint8Array | string,
  hash: string,
  contentType: string,
  expiresAt: string,
): Promise<void> {
  await bucket.put(key, data, {
    sha256: hash,
    httpMetadata: { contentType },
    customMetadata: { expires_at: expiresAt },
  });
}
export async function evidenceExists(bucket: R2Bucket, key: string): Promise<boolean> {
  return Boolean(await bucket.head(key));
}
export async function readEvidence(bucket: R2Bucket, key: string): Promise<ReadableStream | null> {
  return (await bucket.get(key))?.body ?? null;
}
