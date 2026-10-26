import type { OpenApiOperation, OpenApiSpec } from '../models/openapiSharedmodel';
const methods = ['get', 'put', 'post', 'patch', 'delete', 'head'];

/**
 * The OpenAPI document as served. Every website /api/<path> operation, except API key management,
 * also appears at /v1/<path> for an Agent key for every camera, under its own name; the website
 * copy is renamed website_<name>. One document stays the source of both.
 */
export function withKeyPaths<T extends OpenApiSpec>(spec: T): T {
  const paths: OpenApiSpec['paths'] = { ...spec.paths };
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith('/api/') || path === '/api/keys' || path.startsWith('/api/keys/')) continue;
    // Where /v1 already has the method (a machine endpoint), that endpoint answers keys, so it stays.
    const twin = `/v1/${path.slice('/api/'.length)}`,
      website: Record<string, unknown> = {},
      key: Record<string, unknown> = { ...spec.paths[twin] };
    for (const [name, value] of Object.entries(item)) {
      website[name] = value;
      if (name === 'servers' || name in key) continue;
      if (!methods.includes(name)) {
        key[name] = value;
        continue;
      }
      const { servers: _, ...operation } = value as OpenApiOperation;
      website[name] = { ...(value as OpenApiOperation), operationId: `website_${operation.operationId}` };
      key[name] = { ...operation, security: [{ ApiKey: [] }] };
    }
    paths[path] = website;
    paths[twin] = key;
  }
  return { ...spec, paths };
}
