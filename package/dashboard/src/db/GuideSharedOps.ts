import type { Env } from '../models/applicationSharedmodel';

/** Agent guides ship with the website's static files, under /agent/. */
export async function guideText(env: Env, path: string) {
  const page = await env.ASSETS.fetch(`https://assets.local/agent/${path}.md`);
  return page.ok ? page.text() : null;
}
