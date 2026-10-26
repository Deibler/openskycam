export type WorkshopDeletionKind = 'workflow' | 'bucket';

export interface WorkshopDeletionCounts {
  images: number;
  saved_images: number;
  versions: number;
  active_runs: number;
}

export interface WorkshopDeletionPreview extends WorkshopDeletionCounts {
  kind: WorkshopDeletionKind;
  id: string;
  name: string;
  revision: number;
  linked_workflows: { id: string; name: string }[];
}
