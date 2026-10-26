// Types for `env` and `exports` from "cloudflare:workers" inside tests.
import type { D1Migration } from 'cloudflare:test';
import type { Env as IngestEnv } from '../src/models/applicationSharedmodel';

declare global {
  namespace Cloudflare {
    interface Env extends IngestEnv {
      /** Catalog schema, read from db/migrations by vitest.config.ts. */
      TEST_MIGRATIONS: D1Migration[];
    }
    interface GlobalProps {
      mainModule: typeof import('../src/index');
    }
  }
}
