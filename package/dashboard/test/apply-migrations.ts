import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.CATALOG, env.TEST_MIGRATIONS);

await applyD1Migrations(env.API_KEYS, env.TEST_KEY_MIGRATIONS, 'api_key_migrations');
