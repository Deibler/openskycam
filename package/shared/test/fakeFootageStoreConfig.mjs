import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The footage store is reachable only through a remote VPC binding, which tests must never use and
 * Miniflare gives precedence over any service binding of the same name. So tests run from a copy of
 * <dir>/wrangler.jsonc without it (wrangler.test.json, gitignored, beside the original so relative
 * paths still resolve), and STORE is bound to fakeFootageStore.js instead.
 *
 * readRawConfig is wrangler's experimental_readRawConfig, passed in because shared/ has no
 * node_modules of its own.
 */
export function withFakeFootageStore(dir, readRawConfig) {
  const { rawConfig } = readRawConfig({ config: path.join(dir, 'wrangler.jsonc') });
  delete rawConfig.vpc_services;
  for (const environment of Object.values(rawConfig.env ?? {})) delete environment.vpc_services;
  const configPath = path.join(dir, 'wrangler.test.json');
  writeFileSync(configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);

  const token = 'test-store-token';
  return {
    configPath,
    token,
    miniflare: {
      serviceBindings: { STORE: 'footage-store' },
      workers: [
        {
          name: 'footage-store',
          modules: true,
          // Inline: this Miniflare fails to start an auxiliary worker given a scriptPath.
          script: readFileSync(new URL('./fakeFootageStore.js', import.meta.url), 'utf8'),
          compatibilityDate: '2026-09-01',
          bindings: { TOKEN: token },
          r2Buckets: ['BLOBS'],
        },
      ],
    },
  };
}
