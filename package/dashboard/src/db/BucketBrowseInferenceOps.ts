import type { Env } from '../models/applicationSharedmodel';
import type { WorkshopItem } from '../models/workshopInferencemodel';
import type { BucketBrowseFilter, BucketBrowseFacets } from '../models/bucketBrowseInferencemodel';

/** All filters are applied before counting and paging. The cursor uses capture time and ID. */
export async function browse(env: Env, f: BucketBrowseFilter, now: string) {
  const clauses = ['i.bucket_id=?', 'i.expires_at>?', 'i.created_at<=?'];
  const values: (string | number)[] = [f.bucket, now, f.snapshot];
  for (const [column, value] of [
    ['run_id', f.run],
    ['cam', f.camera],
    ['review', f.review],
  ] as const) {
    if (value) {
      clauses.push(`i.${column}=?`);
      values.push(value);
    }
  }
  if (f.from) {
    clauses.push('i.captured_at>=?');
    values.push(f.from);
  }
  if (f.to) {
    clauses.push('i.captured_at<?');
    values.push(f.to);
  }
  if (f.saved) clauses.push("i.object_key LIKE 'retained/%'");
  if (f.query) {
    clauses.push(
      "(instr(lower(i.cam),?)>0 OR instr(lower(r.name),?)>0 OR instr(lower(i.run_id),?)>0 OR EXISTS (SELECT 1 FROM json_each(i.annotation_json) a WHERE instr(lower(json_extract(a.value,'$.class_name')),?)>0))",
    );
    values.push(...Array<string>(4).fill(f.query.toLowerCase()));
  }
  clauses.push('json_array_length(i.annotation_json) BETWEEN ? AND ?');
  values.push(f.minObjects, f.maxObjects);
  if (f.className || f.minConfidence > 0 || f.maxConfidence < 1) {
    clauses.push(
      "EXISTS (SELECT 1 FROM json_each(i.annotation_json) a WHERE (?='' OR json_extract(a.value,'$.class_name')=?) AND json_extract(a.value,'$.confidence') BETWEEN ? AND ?)",
    );
    values.push(f.className, f.className, f.minConfidence, f.maxConfidence);
  }
  const session = env.CATALOG.withSession('first-primary');
  const from = `FROM workshop_items i JOIN workshop_runs r ON r.id=i.run_id WHERE ${clauses.join(' AND ')}`;
  const count = session.prepare(`SELECT COUNT(*) total ${from}`).bind(...values);
  const order = f.oldest ? 'ASC' : 'DESC',
    comparison = f.oldest ? '>' : '<';
  const cursor = f.after ? ` AND (i.captured_at ${comparison} ? OR (i.captured_at=? AND i.id ${comparison} ?))` : '';
  const page = session
    .prepare(`SELECT i.* ${from}${cursor} ORDER BY i.captured_at ${order},i.id ${order} LIMIT ?`)
    .bind(...values, ...(f.after ? [f.after.at, f.after.at, f.after.id] : []), f.limit + 1);
  const [counts, rows] = await session.batch<WorkshopItem | { total: number }>([count, page]);
  return { total: (counts.results[0] as { total: number }).total, items: rows.results as WorkshopItem[] };
}

export async function facets(env: Env, bucket: string, now: string): Promise<BucketBrowseFacets> {
  const session = env.CATALOG.withSession('first-primary');
  const [runs, cameras, classes] = await Promise.all([
    session
      .prepare(
        'SELECT r.id,r.name,r.created_at,COUNT(*) images FROM workshop_items i JOIN workshop_runs r ON r.id=i.run_id WHERE i.bucket_id=? AND i.expires_at>? GROUP BY r.id ORDER BY r.created_at DESC,r.id',
      )
      .bind(bucket, now)
      .all<BucketBrowseFacets['runs'][number]>(),
    session
      .prepare('SELECT DISTINCT cam FROM workshop_items WHERE bucket_id=? AND expires_at>? ORDER BY cam')
      .bind(bucket, now)
      .all<{ cam: string }>(),
    session
      .prepare(
        "SELECT DISTINCT json_extract(a.value,'$.class_name') name FROM workshop_items i,json_each(i.annotation_json) a WHERE i.bucket_id=? AND i.expires_at>? ORDER BY name",
      )
      .bind(bucket, now)
      .all<{ name: string }>(),
  ]);
  return { runs: runs.results, cameras: cameras.results.map(r => r.cam), classes: classes.results.map(r => r.name) };
}

/** A thumbnail kept earlier, if it was made from what `etag` names: the same photo, labels, mode and size. */
export async function keptThumbnail(env: Env, key: string, etag: string) {
  const kept = await env.WORKSHOP!.get(key);
  if (kept?.customMetadata?.etag === etag) return kept.body;
  await kept?.body.cancel();
  return null;
}

/**
 * Keeps a thumbnail until its photo expires. The upload journal records it first, and only while the
 * photo exists, so cleanup removes it as it removes uploads, and deleting the bucket releases it.
 */
export async function keepThumbnail(
  env: Env,
  item: string,
  key: string,
  etag: string,
  bytes: ArrayBuffer,
  sha256: string,
  now: string,
) {
  const journaled = await env.CATALOG.prepare(
    `INSERT INTO workshop_uploads SELECT ?,job_id,0,?,?,expires_at FROM workshop_items WHERE id=? AND expires_at>?
      ON CONFLICT(object_key) DO UPDATE SET sha256=excluded.sha256,bytes=excluded.bytes,expires_at=excluded.expires_at`,
  )
    .bind(key, sha256, bytes.byteLength, item, now)
    .run();
  if (!journaled.meta.changes) return;
  await env.WORKSHOP!.put(key, bytes, {
    sha256,
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: { etag },
  });
}
