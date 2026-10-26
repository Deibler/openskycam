import type { WorkshopRecording } from '../models/workshopInferencemodel';

/** Labeled-bucket inputs nest their original recording in source provenance. */
export function recordingOf(value: unknown): WorkshopRecording | null {
  for (let v = value, depth = 0; v && typeof v === 'object' && depth < 8; depth++) {
    const row = v as Record<string, unknown>;
    if (typeof row.cam === 'string' && typeof row.start === 'string') {
      const count = (key: string) => (typeof row[key] === 'number' ? (row[key] as number) : null);
      return {
        cam: row.cam,
        start: row.start,
        size: count('size') ?? 0,
        duration_s: count('duration_s'),
        frames: count('frames'),
        width: count('width'),
        height: count('height'),
        bitrate: count('bitrate'),
        codec: typeof row.codec === 'string' ? row.codec : null,
      };
    }
    v = row.source;
  }
  return null;
}
