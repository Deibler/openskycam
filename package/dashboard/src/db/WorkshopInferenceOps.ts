import type { Env } from '../models/applicationSharedmodel';
import type {
  WorkshopStateRow,
  WorkshopRuntime,
  WorkshopRun,
  WorkshopRunStatus,
  WorkshopJob,
  WorkshopItem,
  WorkshopVersion,
  WorkshopVersionEntry,
  WorkshopVersionSummary,
  WorkshopUpload,
  WorkshopSeed,
  WorkshopItemSearch,
  WorkshopBucketCount,
} from '../models/workshopInferencemodel';
import type { RecordingRow } from '../models/footageStoragemodel';
export const state = (env: Env) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT revision,document_json FROM workshop_state WHERE id=1')
    .first<WorkshopStateRow>();
export async function saveState(env: Env, revision: number, document: string, now: string) {
  const q =
    revision === 0
      ? env.CATALOG.prepare('INSERT OR IGNORE INTO workshop_state VALUES(1,1,?,?)').bind(document, now)
      : env.CATALOG.prepare(
          'UPDATE workshop_state SET revision=revision+1,document_json=?,updated_at=? WHERE id=1 AND revision=?',
        ).bind(document, now, revision);
  return (await q.run()).meta.changes === 1;
}
export async function runtimes(env: Env) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM workshop_runtimes ORDER BY created_at DESC LIMIT 100')
      .all<WorkshopRuntime>()
  ).results;
}
export const runtime = (env: Env, id: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_runtimes WHERE id=?')
    .bind(id)
    .first<WorkshopRuntime>();
export async function registerRuntime(env: Env, r: WorkshopRuntime) {
  await env.CATALOG.prepare('INSERT OR IGNORE INTO workshop_runtimes VALUES(?,?,?,?,?,NULL)')
    .bind(r.id, r.device_id, r.code_sha256, r.manifest_json, r.created_at)
    .run();
}
export async function seen(env: Env, id: string, now: string) {
  await env.CATALOG.prepare('UPDATE workshop_runtimes SET last_seen_at=? WHERE id=?').bind(now, id).run();
}
export async function recordings(
  env: Env,
  cam: string,
  from: string,
  until: string,
  cutoff: string,
  uploaded = { after: '', until: '9999' },
) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT * FROM segments WHERE cam=? AND start<? AND start>? AND julianday(start)+COALESCE(duration_s,0)/86400.0>julianday(?) AND uploaded_at>? AND uploaded_at<=? ORDER BY start,object_key LIMIT 101`,
      )
      .bind(cam, until, cutoff, from, uploaded.after, uploaded.until)
      .all<RecordingRow>()
  ).results;
}
export const run = (env: Env, id: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_runs WHERE id=?')
    .bind(id)
    .first<WorkshopRun>();
const JOB_CHUNK = 200;
export async function insertRun(env: Env, r: WorkshopRun, jobs: WorkshopSeed[], revision: number) {
  const db = env.CATALOG.withSession('first-primary');
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO workshop_runs SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workshop_state WHERE id=1 AND revision=?)',
      )
      .bind(r.id, r.request_hash, r.workflow_id, r.name, r.runtime_id, r.snapshot_json, r.created_at, revision),
    // D1 caps a bound string at 2 MB. An image job carries its whole bucket item (2-3 KB), so large runs go in chunks.
    ...Array.from({ length: Math.ceil(jobs.length / JOB_CHUNK) }, (_, i) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO workshop_jobs(id,run_id,cam,input_json,expires_at,expected_images) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.cam'),json_extract(value,'$.input_json'),json_extract(value,'$.expires_at'),json_extract(value,'$.expected_images') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM workshop_runs WHERE id=? AND request_hash=?)`,
        )
        .bind(r.id, JSON.stringify(jobs.slice(i * JOB_CHUNK, (i + 1) * JOB_CHUNK)), r.id, r.request_hash),
    ),
  ]);
}
/**
 * Runs newest first, with job and sighting counts. `workflow` narrows to one workflow;
 * `latest` keeps each workflow's newest run only.
 */
export async function listRuns(
  env: Env,
  hiddenWorkflow: string,
  now: string,
  filter: { workflow?: string | null; latest?: boolean; limit?: number } = {},
) {
  const count = (review: string) =>
    `(SELECT COUNT(*) FROM workshop_items i WHERE i.run_id=r.id AND i.expires_at>?3${review ? ` AND i.review='${review}'` : ''})`;
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT r.*,COUNT(j.id) total,SUM(j.status='completed') completed,SUM(j.status='queued') queued,SUM(j.status='leased') leased,SUM(j.status='failed') failed,SUM(j.status='expired') expired,SUM(j.status='cancelled') cancelled,${count('')} images,${count('pending')} pending,${count('accepted')} accepted,${count('rejected')} rejected FROM workshop_runs r JOIN workshop_jobs j ON j.run_id=r.id WHERE r.workflow_id<>?1 AND (?2 IS NULL OR r.workflow_id=?2) AND (?4=0 OR r.created_at=(SELECT MAX(x.created_at) FROM workshop_runs x WHERE x.workflow_id=r.workflow_id)) GROUP BY r.id ORDER BY r.created_at DESC,r.id DESC LIMIT ?5`,
      )
      .bind(hiddenWorkflow, filter.workflow ?? null, now, Number(!!filter.latest), filter.limit ?? 100)
      .all<WorkshopRunStatus>()
  ).results;
}
/**
 * The next recording to process. One workflow run at a time per processor: a run's recordings wait
 * until every older unfinished run is done. Photos (one frame each) go first and never wait.
 */
export async function claim(
  env: Env,
  runtimeId: string,
  cameras: string[],
  owner: string,
  token: string,
  now: string,
  until: string,
  photoWorkflow: string,
) {
  const db = env.CATALOG.withSession('first-primary');
  await db
    .prepare(`UPDATE workshop_jobs SET status='expired' WHERE expires_at<=? AND status IN ('queued','leased')`)
    .bind(now)
    .run();
  await db
    .prepare(
      `UPDATE workshop_jobs SET status='failed',error='attempts_exhausted' WHERE status='leased' AND lease_until<=? AND generation>=3`,
    )
    .bind(now)
    .run();
  return db
    .prepare(
      `UPDATE workshop_jobs SET status='leased',progress_json='{}',generation=generation+1,lease_owner=?1,lease_token=?2,lease_until=MIN(expires_at,?3) WHERE id=(SELECT j.id FROM workshop_jobs j JOIN workshop_runs r ON r.id=j.run_id WHERE r.runtime_id=?4 AND j.cam IN (SELECT value FROM json_each(?5)) AND (j.status='queued' OR (j.status='leased' AND j.lease_until<=?6)) AND j.expires_at>?6 AND j.generation<3 AND (r.workflow_id=?7 OR NOT EXISTS(SELECT 1 FROM workshop_runs o JOIN workshop_jobs oj ON oj.run_id=o.id WHERE o.runtime_id=r.runtime_id AND o.workflow_id<>?7 AND o.id<>r.id AND (o.created_at<r.created_at OR (o.created_at=r.created_at AND o.id<r.id)) AND oj.status IN ('queued','leased') AND oj.expires_at>?6)) ORDER BY r.workflow_id=?7 DESC,r.created_at,LENGTH(j.id),j.id LIMIT 1) RETURNING *`,
    )
    .bind(owner, token, until, runtimeId, JSON.stringify(cameras), now, photoWorkflow)
    .first<WorkshopJob>();
}
export const job = (env: Env, id: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_jobs WHERE id=?')
    .bind(id)
    .first<WorkshopJob>();
export async function renew(env: Env, j: WorkshopJob, now: string, until: string) {
  return (
    (
      await env.CATALOG.prepare(
        `UPDATE workshop_jobs SET lease_until=MIN(expires_at,?) WHERE id=? AND status='leased' AND generation=? AND lease_token=? AND lease_until>? AND expires_at>?`,
      )
        .bind(until, j.id, j.generation, j.lease_token, now, now)
        .run()
    ).meta.changes === 1
  );
}
export async function fail(env: Env, j: WorkshopJob, now: string, error: string) {
  return (
    (
      await env.CATALOG.prepare(
        `UPDATE workshop_jobs SET status='failed',error=? WHERE id=? AND status='leased' AND generation=? AND lease_token=? AND lease_until>? AND expires_at>?`,
      )
        .bind(error, j.id, j.generation, j.lease_token, now, now)
        .run()
    ).meta.changes === 1
  );
}
export async function cancel(env: Env, id: string) {
  await env.CATALOG.prepare(
    `UPDATE workshop_jobs SET status='cancelled' WHERE run_id=? AND status IN ('queued','leased')`,
  )
    .bind(id)
    .run();
}
export async function putImage(env: Env, key: string, bytes: Uint8Array<ArrayBuffer>, sha: string) {
  await env.WORKSHOP!.put(key, bytes, {
    sha256: sha,
    httpMetadata: { contentType: 'image/jpeg' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
}
export const imageHead = (env: Env, key: string) => env.WORKSHOP!.head(key);
export const image = (env: Env, key: string) => env.WORKSHOP!.get(key);
export async function upload(env: Env, u: WorkshopUpload) {
  await env.CATALOG.prepare('INSERT OR IGNORE INTO workshop_uploads VALUES(?,?,?,?,?,?)')
    .bind(u.object_key, u.job_id, u.generation, u.sha256, u.bytes, u.expires_at)
    .run();
}
export async function complete(
  env: Env,
  j: WorkshopJob,
  digest: string,
  items: WorkshopItem[],
  now: string,
  test = false,
) {
  const db = env.CATALOG.withSession('first-primary');
  const rs = await db.batch([
    db
      .prepare(
        `UPDATE workshop_jobs SET status='completed',result_sha256=?,completed_at=? WHERE id=? AND status='leased' AND generation=? AND lease_token=? AND lease_until>? AND expires_at>?`,
      )
      .bind(digest, now, j.id, j.generation, j.lease_token, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO workshop_items SELECT json_extract(v.value,'$.id'),json_extract(v.value,'$.bucket_id'),json_extract(v.value,'$.asset_id'),json_extract(v.value,'$.run_id'),json_extract(v.value,'$.job_id'),json_extract(v.value,'$.source_sha256'),json_extract(v.value,'$.cam'),json_extract(v.value,'$.captured_at'),json_extract(v.value,'$.object_key'),json_extract(v.value,'$.sha256'),json_extract(v.value,'$.expires_at'),json_extract(v.value,'$.annotation_json'),json_extract(v.value,'$.provenance_json'),'pending',? FROM json_each(?) v WHERE EXISTS(SELECT 1 FROM workshop_jobs WHERE id=? AND status='completed' AND result_sha256=? AND generation=? AND lease_token=?) AND EXISTS(SELECT 1 FROM workshop_state s,json_each(s.document_json,'$.buckets') b WHERE json_extract(b.value,'$.id')=json_extract(v.value,'$.bucket_id'))`,
      )
      .bind(now, JSON.stringify(test ? [] : items), j.id, digest, j.generation, j.lease_token),
    db
      .prepare(
        `INSERT OR REPLACE INTO workshop_previews SELECT ?,?,CAST(v.key AS INTEGER),json_extract(v.value,'$.id'),v.value,json_extract(v.value,'$.expires_at') FROM json_each(?) v WHERE EXISTS(SELECT 1 FROM workshop_jobs WHERE id=? AND status='completed' AND result_sha256=? AND generation=? AND lease_token=?) AND EXISTS(SELECT 1 FROM workshop_state s,json_each(s.document_json,'$.buckets') b WHERE json_extract(b.value,'$.id')=json_extract(v.value,'$.bucket_id'))`,
      )
      .bind(j.id, j.generation, JSON.stringify(test ? items : []), j.id, digest, j.generation, j.lease_token),
    db
      .prepare(
        `DELETE FROM workshop_previews WHERE job_id=? AND ?=0 AND EXISTS(SELECT 1 FROM workshop_jobs WHERE id=? AND status='completed' AND result_sha256=? AND generation=? AND lease_token=?)`,
      )
      .bind(j.id, Number(test), j.id, digest, j.generation, j.lease_token),
  ]);
  return rs[0].meta.changes === 1;
}
export async function items(env: Env, bucket: string, now: string, limit = 501) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT * FROM workshop_items WHERE bucket_id=? AND expires_at>? ORDER BY captured_at DESC,created_at DESC,id LIMIT ?`,
      )
      .bind(bucket, now, limit)
      .all<WorkshopItem>()
  ).results;
}
/** Accepted labels, and rejected ones when asked: accepted first, then newest, so a version keeps the best proposal per image. */
export async function reviewedItems(env: Env, bucket: string, now: string, includeRejected: boolean) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT * FROM workshop_items WHERE bucket_id=? AND expires_at>? AND (review='accepted' OR (?=1 AND review='rejected')) ORDER BY review='accepted' DESC,captured_at DESC,created_at DESC,id`,
      )
      .bind(bucket, now, includeRejected ? 1 : 0)
      .all<WorkshopItem>()
  ).results;
}
/** Filter before limiting, so rejected proposals cannot hide additional eligible inputs. */
export async function inputItems(
  env: Env,
  bucket: string,
  now: string,
  limit: number,
  since = '',
  includeRejected = false,
) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        "SELECT * FROM workshop_items WHERE bucket_id=? AND expires_at>? AND (?=1 OR review!='rejected') AND created_at>? AND created_at<=? ORDER BY captured_at DESC,created_at DESC,id LIMIT ?",
      )
      .bind(bucket, now, includeRejected ? 1 : 0, since, now, limit)
      .all<WorkshopItem>()
  ).results;
}
export const item = (env: Env, id: string, now: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_items WHERE id=? AND expires_at>?')
    .bind(id, now)
    .first<WorkshopItem>();
/** Records a decision; `annotations` replaces the labels when the reviewer edited them. */
export async function review(env: Env, id: string, status: string, now: string, annotations: string | null = null) {
  return (
    (
      await env.CATALOG.prepare(
        'UPDATE workshop_items SET review=?,annotation_json=COALESCE(?,annotation_json) WHERE id=? AND expires_at>?',
      )
        .bind(status, annotations, id, now)
        .run()
    ).meta.changes === 1
  );
}
export async function versions(env: Env, bucket: string, now: string) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT id,bucket_id,name,sha256,created_at,(SELECT COUNT(*) FROM workshop_version_items WHERE version_id=v.id) images FROM workshop_versions v WHERE bucket_id=? AND NOT EXISTS(SELECT 1 FROM workshop_version_items WHERE version_id=v.id AND expires_at<=?) ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(bucket, now)
      .all<WorkshopVersionSummary>()
  ).results;
}
export const version = (env: Env, id: string) =>
  env.CATALOG.withSession('first-primary')
    .prepare('SELECT * FROM workshop_versions WHERE id=?')
    .bind(id)
    .first<WorkshopVersion>();
/** The row and its items in one transaction, so a concurrent deletion cannot return part of a manifest. */
export async function versionManifest(env: Env, id: string) {
  const db = env.CATALOG.withSession('first-primary');
  const [row, items] = await db.batch([
    db.prepare('SELECT * FROM workshop_versions WHERE id=?').bind(id),
    db.prepare('SELECT item_json FROM workshop_version_items WHERE version_id=? ORDER BY position').bind(id),
  ]);
  const v = (row.results as WorkshopVersion[])[0];
  return v && { ...v, items: (items.results as { item_json: string }[]).map(i => i.item_json) };
}
/** Items go in about 1 MB per statement (a D1 string is at most 2 MB), committed with the guarded version row. */
export async function insertVersion(
  env: Env,
  v: WorkshopVersion,
  items: WorkshopVersionEntry[],
  now: string,
) {
  const db = env.CATALOG,
    chunks: string[][] = [[]];
  let size = 0;
  for (const item of items) {
    const json = JSON.stringify(item);
    if (size + json.length > 1_000_000 && chunks.at(-1)!.length) {
      chunks.push([]);
      size = 0;
    }
    chunks.at(-1)!.push(json);
    size += json.length + 1;
  }
  let position = 0;
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO workshop_versions(id,bucket_id,name,manifest_json,sha256,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM workshop_items i,json_each(?) j WHERE i.id=json_extract(j.value,'$[0]') AND i.review=json_extract(j.value,'$[1]') AND i.expires_at>?)=?`,
      )
      .bind(
        v.id,
        v.bucket_id,
        v.name,
        v.manifest_json,
        v.sha256,
        v.created_at,
        JSON.stringify(items.map(i => [i.item_id, i.review])),
        now,
        items.length,
      ),
    ...chunks.map(chunk => {
      const statement = db
        .prepare(
          `INSERT INTO workshop_version_items SELECT ?,?+key,json_extract(value,'$.expires_at'),value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM workshop_versions WHERE id=? AND sha256=? AND created_at=?)`,
        )
        .bind(v.id, position, `[${chunk.join(',')}]`, v.id, v.sha256, v.created_at);
      position += chunk.length;
      return statement;
    }),
  ]);
  return inserted.meta.changes === 1;
}
export async function expiredUploads(env: Env, now: string) {
  return (
    await env.CATALOG.prepare(
      `SELECT * FROM workshop_uploads u WHERE expires_at<=?
        AND NOT EXISTS(SELECT 1 FROM workshop_items i WHERE i.object_key=u.object_key AND i.expires_at>?)
        AND NOT EXISTS(SELECT 1 FROM workshop_previews p WHERE json_extract(p.item_json,'$.object_key')=u.object_key AND p.expires_at>?)
        AND NOT EXISTS(SELECT 1 FROM workshop_jobs j WHERE j.status IN ('queued','leased') AND j.expires_at>? AND json_extract(j.input_json,'$.item.object_key')=u.object_key)
        LIMIT 500`,
    )
      .bind(now, now, now, now)
      .all<WorkshopUpload>()
  ).results;
}
export async function removeUpload(env: Env, key: string) {
  await env.WORKSHOP!.delete(key);
  await env.CATALOG.prepare('DELETE FROM workshop_uploads WHERE object_key=?').bind(key).run();
}

export async function purgeExpiredLabels(env: Env, now: string) {
  const db = env.CATALOG.withSession('first-primary');
  await db.batch([
    db
      .prepare(
        'DELETE FROM workshop_versions WHERE id IN(SELECT version_id FROM workshop_version_items WHERE expires_at<=?)',
      )
      .bind(now),
    db.prepare('DELETE FROM workshop_items WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM workshop_previews WHERE expires_at<=?').bind(now),
    db
      .prepare(
        "UPDATE workshop_jobs SET input_json='{}',status='expired' WHERE expires_at<=? AND (status!='expired' OR input_json!='{}')",
      )
      .bind(now),
  ]);
}
export async function copyRetained(env: Env, key: string, body: ReadableStream<Uint8Array>, sha: string) {
  await env.WORKSHOP!.put(key, body, {
    sha256: sha,
    httpMetadata: { contentType: 'image/jpeg' },
  });
}
export async function retainItem(
  env: Env,
  item: WorkshopItem,
  key: string,
  provenance: string,
  retainedExpiry: string,
  now: string,
) {
  const db = env.CATALOG.withSession('first-primary');
  const result = await db.batch([
    db
      .prepare(
        `UPDATE workshop_items SET object_key=?,provenance_json=?,expires_at=? WHERE id=? AND object_key=? AND expires_at>? AND EXISTS(SELECT 1 FROM workshop_uploads WHERE object_key=? AND expires_at>?)`,
      )
      .bind(key, provenance, retainedExpiry, item.id, item.object_key, now, key, now),
    db
      .prepare(
        `UPDATE workshop_uploads SET expires_at=? WHERE object_key=? AND EXISTS(SELECT 1 FROM workshop_items WHERE id=? AND object_key=? AND expires_at=?)`,
      )
      .bind(retainedExpiry, key, item.id, key, retainedExpiry),
  ]);
  return result[0].meta.changes === 1;
}
/** Newest first. Class and confidence filters match any single prediction on the image. */
export async function searchItems(env: Env, f: WorkshopItemSearch, now: string) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT * FROM workshop_items i WHERE i.expires_at>?1 AND i.cam IN (SELECT value FROM json_each(?2)) AND (?3 IS NULL OR i.bucket_id=?3) AND (?4 IS NULL OR i.run_id=?4) AND (?5 IS NULL OR i.review=?5) AND (?6 IS NULL OR i.captured_at>=?6) AND (?7 IS NULL OR i.captured_at<?7) AND ((?8 IS NULL AND ?9 IS NULL) OR EXISTS(SELECT 1 FROM json_each(i.annotation_json) a WHERE (?8 IS NULL OR lower(json_extract(a.value,'$.class_name'))=lower(?8)) AND json_extract(a.value,'$.confidence')>=COALESCE(?9,0))) ORDER BY i.captured_at DESC,i.id LIMIT ?10 OFFSET ?11`,
      )
      .bind(
        now,
        JSON.stringify(f.cameras),
        f.bucket,
        f.run,
        f.review,
        f.from,
        f.to,
        f.className,
        f.minConfidence,
        f.limit,
        f.offset,
      )
      .all<WorkshopItem>()
  ).results;
}
export async function itemsByIds(env: Env, ids: string[], now: string) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare('SELECT * FROM workshop_items WHERE id IN (SELECT value FROM json_each(?)) AND expires_at>?')
      .bind(JSON.stringify(ids), now)
      .all<WorkshopItem>()
  ).results;
}
export async function bucketCounts(env: Env, now: string) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        "SELECT bucket_id,COUNT(*) images,SUM(review='accepted') accepted,SUM(review='rejected') rejected,SUM(review='pending') pending,SUM(object_key LIKE 'retained/%') saved,MAX(created_at) last_added_at FROM workshop_items WHERE expires_at>? GROUP BY bucket_id",
      )
      .bind(now)
      .all<WorkshopBucketCount>()
  ).results;
}
/** Older unfinished workflow runs on the same processor, which this run waits behind. */
export async function runsAhead(env: Env, run: WorkshopRun, photoWorkflow: string, now: string) {
  return (
    await env.CATALOG.withSession('first-primary')
      .prepare(
        `SELECT o.id,o.name FROM workshop_runs o WHERE o.runtime_id=?1 AND o.workflow_id<>?2 AND o.id<>?3 AND (o.created_at<?4 OR (o.created_at=?4 AND o.id<?3)) AND EXISTS(SELECT 1 FROM workshop_jobs oj WHERE oj.run_id=o.id AND oj.status IN ('queued','leased') AND oj.expires_at>?5) ORDER BY o.created_at,o.id LIMIT 5`,
      )
      .bind(run.runtime_id, photoWorkflow, run.id, run.created_at, now)
      .all<{ id: string; name: string }>()
  ).results;
}
