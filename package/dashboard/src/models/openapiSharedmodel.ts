/** The parts of an OpenAPI document the served copy rewrites. */
export interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}
export interface OpenApiOperation {
  operationId: string;
  servers?: unknown;
  security?: unknown;
}
