import type {
  WorkshopDeletionKind,
  WorkshopDeletionPreview,
} from '../../../../src/models/workshopDeletionInferencemodel';

export interface WorkshopDeletionTarget {
  kind: WorkshopDeletionKind;
  id: string;
  name: string;
}
export interface WorkshopDeletionDialogProps {
  target: WorkshopDeletionTarget;
  onPrepare: (kind: WorkshopDeletionKind, id: string) => Promise<WorkshopDeletionPreview>;
  onDelete: (kind: WorkshopDeletionKind, id: string, revision: number) => Promise<void>;
  onClose: () => void;
}
