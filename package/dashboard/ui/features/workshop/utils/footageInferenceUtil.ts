import type { Segment } from '../../../lib/types';
import type { FootageSummary } from '../models/workflowInferencemodel';

export function summarizeFootage(segments: Segment[], from: number, until: number, interval: number): FootageSummary {
  const clips = segments.filter(
    segment =>
      Date.parse(segment.start) < until && Date.parse(segment.start) + (segment.duration_s ?? 60) * 1000 > from,
  );
  const spans = clips
    .map(segment => ({
      from: Math.max(from, Date.parse(segment.start)),
      until: Math.min(until, Date.parse(segment.start) + (segment.duration_s ?? 60) * 1000),
    }))
    .sort((a, b) => a.from - b.from);
  let seconds = 0,
    end = -Infinity;
  for (const span of spans) {
    seconds += Math.max(0, span.until - Math.max(end, span.from)) / 1000;
    end = Math.max(end, span.until);
  }
  return {
    clips,
    seconds,
    bytes: clips.reduce((sum, segment) => sum + segment.size, 0),
    samples: Math.ceil(seconds / interval),
  };
}
