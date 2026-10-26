export type { Segment, Overview } from './archive/api.js';
export type Zone = 'local' | 'UTC';
export type Selection = { segment: import('./archive/api.js').Segment; id: number; play: boolean; offset: number };
export type ReviewRange = { from: number; to: number };
