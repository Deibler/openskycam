/**
 * wrangler.jsonc holds no deployment's hosts or account IDs. This writes wrangler.deploy.json beside
 * it with yours, from the environment or the repository's .env; every wrangler command that runs the
 * Worker uses that file. In wrangler.jsonc:
 * - a var set to "" takes the environment variable of the same name (required);
 * - a vpc_services binding without service_id takes <BINDING>_SERVICE_ID (required); wrangler
 *   refuses the binding without one, so deploying wrangler.jsonc directly fails before upload;
 * - a D1 binding without database_id takes D1_DATABASE_ID when set. Deploys and remote migrations
 *   find the database by name without it; `wrangler dev` with remote bindings needs it.
 * --domains names environment variables holding the Worker's custom domains (required).
 *
 * Usage, from a Worker directory: node ../shared/deploy-config.mjs [--domains SITE_HOST,API_HOST]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Returns the deployment's config, and the environment variables it still needs. */
export function deploymentConfig(raw, env, domains = []) {
  const config = structuredClone(raw);
  const missing = new Set();
  const need = name => {
    if (!env[name]) missing.add(name);
    return env[name];
  };
  for (const scope of [config, ...Object.values(config.env ?? {})]) {
    for (const [name, value] of Object.entries(scope.vars ?? {})) if (value === '') scope.vars[name] = need(name);
    for (const service of scope.vpc_services ?? [])
      service.service_id ??= need(`${service.binding}_SERVICE_ID`);
    for (const database of scope.d1_databases ?? [])
      if (!database.database_id && env.D1_DATABASE_ID) database.database_id = env.D1_DATABASE_ID;
  }
  if (domains.length) config.routes = domains.map(name => ({ pattern: need(name), custom_domain: true }));
  return { config, missing: [...missing] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--domains');
  const domains = flag === -1 ? [] : process.argv[flag + 1].split(',');
  const dotenv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
  // Values already in the environment (Workers Builds variables, the shell) win over .env.
  if (fs.existsSync(dotenv)) process.loadEnvFile(dotenv);
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const { rawConfig } = require('wrangler').experimental_readRawConfig({ config: 'wrangler.jsonc' });
  const { config, missing } = deploymentConfig(rawConfig, process.env, domains);
  if (missing.length) {
    console.error(`Set ${missing.join(', ')} in the environment or the repository's .env (see .env.example).`);
    process.exit(1);
  }
  fs.writeFileSync('wrangler.deploy.json', `${JSON.stringify(config, null, 2)}\n`);
}
