const MINUTE_MS = 60_000;

/** Workers Free and Pro reject request bodies over 100 MB; stay clear of that edge. */
export const MAX_SEGMENT_BYTES = 95 * 1024 * 1024;

/** How far ahead of the Worker's clock a segment start may be. */
export const MAX_CLOCK_SKEW_MS = 5 * MINUTE_MS;

/** A camera whose newest segment is older than this is reported unhealthy. */
export const STALE_AFTER_MS = 3 * MINUTE_MS;
