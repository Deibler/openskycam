import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { experimental_readRawConfig } from 'wrangler';
import { withFakeFootageStore } from '../shared/test/fakeFootageStoreConfig.mjs';

// Tests run inside the Workers runtime with the bindings from wrangler.jsonc (D1 is simulated
// locally, and STORE is a local stand-in for the footage store). The catalog schema from
// db/migrations is applied before the tests run.
const store = withFakeFootageStore(import.meta.dirname, experimental_readRawConfig);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: store.configPath },
      remoteBindings: false,
      miniflare: {
        ...store.miniflare,
        bindings: {
          INGEST_TOKEN: 'test-token',
          CAMERAS: 'sky01',
          STORE_TOKEN: store.token,
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, '../../db/migrations')),
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
