import type { IdRow } from '../../../shared/src/models/httpSharedmodel';
import type { Pipeline } from '../models/processorInferencemodel';
export async function listPipelineIds(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT id FROM inference_pipelines ORDER BY created_at DESC LIMIT 100')
    .all<IdRow>();
  return results.map(row => row.id);
}
export function findPipeline(db: D1Database, id: string): Promise<Pipeline | null> {
  return db
    .withSession('first-primary')
    .prepare('SELECT * FROM inference_pipelines WHERE id = ?')
    .bind(id)
    .first<Pipeline>();
}
export async function subscriptionEnabled(db: D1Database, pipeline: string, cam: string): Promise<boolean> {
  return Boolean(
    await db
      .withSession('first-primary')
      .prepare('SELECT 1 FROM inference_subscriptions WHERE pipeline_id = ? AND cam = ? AND enabled = 1')
      .bind(pipeline, cam)
      .first(),
  );
}
