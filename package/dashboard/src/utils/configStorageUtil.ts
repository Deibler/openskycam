export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** A camera whose newest segment arrived longer ago than this is reported stale. */
export const STALE_AFTER_MS = 3 * 60_000;

/** Longest time range one segments request may cover. */
export const MAX_RANGE_MS = 48 * HOUR_MS;
