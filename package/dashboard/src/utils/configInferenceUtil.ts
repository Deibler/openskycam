export const LEASE_MS = 300_000;
export const MAX_ATTEMPTS = 3;
export const hashPattern = /^[a-f0-9]{64}$/;
export const instant = (): string => new Date().toISOString();
