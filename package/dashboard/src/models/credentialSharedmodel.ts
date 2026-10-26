export type CredentialScope =
  | 'footage:read'
  | 'processor:run'
  | 'models:write'
  | 'models:sync'
  | 'workshop:run'
  | 'agent';
export interface KeyRow {
  scope: CredentialScope;
  device_id: string | null;
  pipeline_id: string | null;
  id: string;
  owner: string;
  name: string;
  secret_hash: string;
  prefix: string;
  cameras: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  rotated_at: string | null;
  revoked_at: string | null;
}
export interface ApiPrincipal {
  id: string;
  cameras: string[];
  scope: CredentialScope;
  device_id?: string | null;
  pipeline_id: string | null;
}
export interface CredentialSecret {
  token: string;
  hash: string;
  prefix: string;
}
export type CredentialDescription = Omit<KeyRow, 'owner' | 'secret_hash' | 'cameras' | 'pipeline_id'> & {
  cameras: string[];
  pipeline_id?: string;
};
export interface CredentialList {
  devices: string[];
  pipelines: string[];
  keys: CredentialDescription[];
  cameras: string[];
  max_active_keys: number;
}
export interface CredentialResult {
  key: CredentialDescription;
}
export interface IssuedCredential extends CredentialResult {
  token: string;
}
export type NewCredentialRow = Omit<KeyRow, 'last_used_at' | 'rotated_at' | 'revoked_at'>;
export interface AuthenticatedCredential {
  principal: ApiPrincipal;
  recordUsage: Promise<void>;
}
