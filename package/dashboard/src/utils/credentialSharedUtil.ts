import { sha256 } from '../../../shared/src/utils/cryptoSharedUtil';
import type { CredentialSecret } from '../models/credentialSharedmodel';
export async function newSecret(id: string): Promise<CredentialSecret> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const token = `svk_${id}_${secret}`;
  return {
    token,
    hash: await sha256(token),
    prefix: `svk_${id.slice(0, 8)}…${secret.slice(-4)}`,
  };
}
