import { route } from '../../../shared/src/utils/routerSharedUtil';
import type { MachineApp } from '../models/applicationSharedmodel';
import { mcpHandler, mcpStreamHandler } from '../handler/agentSharedHandler';
export const agentSharedRoutes = [
  route<MachineApp>('POST', '/v1/mcp', mcpHandler),
  route<MachineApp>('GET', '/v1/mcp', mcpStreamHandler),
  route<MachineApp>('DELETE', '/v1/mcp', mcpStreamHandler),
];
