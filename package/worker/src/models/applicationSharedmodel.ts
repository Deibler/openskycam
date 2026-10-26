/** Bindings configured in wrangler.jsonc, plus the INGEST_TOKEN and STORE_TOKEN secrets. */
export interface Env {
  /** The footage store (external/store), through a Workers VPC service. */
  STORE: Fetcher;
  /** Bearer token the footage store requires. */
  STORE_TOKEN: string;
  /** D1 catalog of stored segments, read by the dashboard. Schema: db/migrations. */
  CATALOG: D1Database;
  /** Comma-separated camera ids the relay may upload for, e.g. "sky01". */
  CAMERAS: string;
  /** Shared secret the relay sends as a bearer token. */
  INGEST_TOKEN: string;
}
