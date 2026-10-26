import type { WorkshopRecording, WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';

export type SightingState = 'pending' | 'accepted' | 'rejected' | 'mixed';
/** Consecutive frames grouped for run summaries. */
export interface Sighting {
  id: string;
  bucketId: string;
  className: string;
  frames: WorkshopRunImage[];
}
/** The part of a recording that shows a sighting, in seconds from the recording's start. */
export interface SightingClip {
  recording: WorkshopRecording;
  from: number;
  to: number;
}
/** Whole videos in feed order, about a screen of photos; each video lists its sightings' places in the feed. */
export interface SightingBatch {
  videos: { start: string; sightings: number[] }[];
  photos: number;
}
/** What a reviewer says a photo shows in a batch: one of its model's classes, or null for none of them. */
export type PhotoMark = string | null;
