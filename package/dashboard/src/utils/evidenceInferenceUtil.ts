import type { Job } from '../models/processorInferencemodel';
export function evidenceKey(job: Job, hash: string) {
  return `inference/${job.id}/${job.generation}/${hash}.jpg`;
}
