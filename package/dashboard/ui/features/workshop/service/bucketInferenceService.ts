import type { BucketUsage, WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkshopDocument } from '../models/workflowInferencemodel';

export const CAMERA_ARCHIVE_ID = 'camera-archive';
export const cameraArchive: WorkshopBucket = {
  id: CAMERA_ARCHIVE_ID,
  name: 'Camera archive',
  kind: 'raw',
  createdAt: null,
  description: 'Original video from your cameras, continuously added to the archive.',
};
export function bucketNameIssue(name: string, buckets: WorkshopBucket[], exceptId = ''): string {
  if (!name.trim()) return 'Give this bucket a name.';
  if (name.trim().length > 100) return 'Use 100 characters or fewer.';
  if (buckets.some(bucket => bucket.id !== exceptId && bucket.name.toLowerCase() === name.trim().toLowerCase()))
    return 'A bucket already uses that name.';
  return '';
}
export function createBucket(name: string, buckets: WorkshopBucket[], description = ''): WorkshopBucket {
  if (buckets.length >= 500) throw new Error('This browser can hold up to 500 buckets.');
  const error = bucketNameIssue(name, buckets);
  if (error) throw new Error(error);
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    kind: 'labeled',
    description: description.trim().slice(0, 300),
    createdAt: new Date().toISOString(),
  };
}
export function uniqueBucketName(name: string, buckets: WorkshopBucket[]): string {
  const base = name.trim().slice(0, 90) || 'Labeled images';
  let result = base,
    suffix = 2;
  while (bucketNameIssue(result, buckets)) result = `${base} ${suffix++}`;
  return result;
}
export function bucketUsage(bucketId: string, workflows: WorkflowDraft[]): BucketUsage {
  const uses = (kind: 'input' | 'output') =>
    workflows
      .filter(workflow => workflow.nodes.some(node => node.data.kind === kind && node.data.bucketId === bucketId))
      .map(workflow => workflow.id);
  return { writes: uses('output'), reads: uses('input') };
}
export function renameBucket(
  document: WorkshopDocument,
  id: string,
  name: string,
  description: string,
): WorkshopDocument {
  const bucket = document.buckets.find(bucket => bucket.id === id);
  if (!bucket || bucket.kind === 'raw') throw new Error('The camera archive is managed automatically.');
  const error = bucketNameIssue(name, document.buckets, id);
  if (error) throw new Error(error);
  return {
    ...document,
    buckets: document.buckets.map(bucket =>
      bucket.id === id ? { ...bucket, name: name.trim(), description: description.trim().slice(0, 300) } : bucket,
    ),
  };
}
/** A current-contents input cannot feed back into its own dependency chain. */
export function hasBucketCycle(workflow: WorkflowDraft, workflows: WorkflowDraft[]): boolean {
  const all = [...workflows.filter(item => item.id !== workflow.id), workflow];
  const upstream = (id: string): string[] => {
    const inputs =
      all
        .find(item => item.id === id)
        ?.nodes.flatMap(node => (node.data.kind === 'input' ? [node.data.bucketId] : [])) ?? [];
    return all
      .filter(item => item.nodes.some(node => node.data.kind === 'output' && inputs.includes(node.data.bucketId)))
      .map(item => item.id);
  };
  const seen = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (seen.has(id)) return false;
    visiting.add(id);
    const cycle = upstream(id).some(visit);
    visiting.delete(id);
    seen.add(id);
    return cycle;
  }
  return visit(workflow.id);
}
