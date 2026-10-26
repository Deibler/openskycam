import { authenticateToken } from '../service/authSharedService';
import type { Env } from '../models/applicationSharedmodel';
export function authenticate(request: Request, env: Env): Promise<void> {
  return authenticateToken(request.headers.get('Authorization') ?? '', env.INGEST_TOKEN);
}
