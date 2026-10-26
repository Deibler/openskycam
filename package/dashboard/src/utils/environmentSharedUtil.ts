import type { Env } from '../models/applicationSharedmodel';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const isLocalHost = (hostname: string): boolean => LOCAL_HOSTS.has(hostname);
export const isLocalDevelopment = (hostname: string, env: Env): boolean =>
  Boolean(env.DEV_VIEWER_EMAIL) && isLocalHost(hostname);
