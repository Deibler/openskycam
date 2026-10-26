import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { experimental_readRawConfig } from 'wrangler';
import { withFakeFootageStore } from '../shared/test/fakeFootageStoreConfig.mjs';

// Tests run inside the Workers runtime with the bindings from wrangler.jsonc (R2, D1 and the static
// assets are local, and STORE is a local stand-in for the footage store). The deployment values that
// wrangler.jsonc leaves empty are test values here. Access is simulated: tests sign their own tokens
// for this team domain.
const store = withFakeFootageStore(import.meta.dirname, experimental_readRawConfig);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: store.configPath },
      remoteBindings: false,
      miniflare: {
        ...store.miniflare,
        r2Buckets: ['EVIDENCE'],
        bindings: {
          STORE_TOKEN: store.token,
          INFERENCE_ENABLED: 'true',
          CAMERAS: 'sky01',
          API_HOST: 'api.example.com',
          ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
          ACCESS_AUD: 'test-audience',
          // Set in tests too, so every Access test also proves it has no effect off localhost.
          DEV_VIEWER_EMAIL: 'local-dev@example.com',
          TEST_KEY_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'db/migrations')),
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, '../../db/migrations')),
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
