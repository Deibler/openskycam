import type { ReactNode } from 'react';
import type { WorkshopRunDetail } from '../../../../src/models/workshopInferencemodel';
export interface RunRequest {
  mode: 'test' | 'run';
  image_limit?: number;
}
export interface RunOutputProps {
  run: WorkshopRunDetail | null;
  error: string;
  compact?: boolean;
  /** Replaces the latest-output grid, e.g. with a full run's sightings. */
  results?: ReactNode;
  onCancel: () => void;
  onRefresh: () => void;
  onOpen?: () => void;
  onBucket?: (id: string) => void;
}

export interface RunDetailProps {
  id: string;
  onBack: () => void;
  onWorkflow: (id: string) => void;
  onBucket: (id: string) => void;
  onReview: (item?: string) => void;
}
export interface RunListProps {
  onWorkflows: () => void;
  onRun: (id: string) => void;
}
