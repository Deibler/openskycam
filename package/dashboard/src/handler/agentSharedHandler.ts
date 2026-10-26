import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { MachineApp } from '../models/applicationSharedmodel';
import { privateJson, readBody } from '../../../shared/src/utils/httpSharedUtil';
import { ApplicationError } from '../../../shared/src/utils/errorSharedUtil';
import { mcp } from '../service/agentSharedService';

const rpcError = (id: unknown, code: number, message: string) =>
  privateJson({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** MCP Streamable HTTP, stateless: one JSON-RPC message per POST, answered with JSON. */
export const mcpHandler: Handler<MachineApp> = async (request, app) => {
  const message = await readBody(request, 1_000_000);
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    // A client's reply to a server request, which this server never makes.
    if (message.jsonrpc === '2.0' && ('result' in message || 'error' in message))
      return new Response(null, { status: 202 });
    return rpcError(message.id, -32600, 'Expected one JSON-RPC 2.0 request.');
  }
  if (message.id === undefined) return new Response(null, { status: 202 }); // notifications need no answer
  const params =
    message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {};
  try {
    const result = await mcp(app, message.method, params as Record<string, unknown>);
    return result === undefined
      ? rpcError(message.id, -32601, `Method ${message.method} is not supported.`)
      : privateJson({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    // Authentication and permission failures stay HTTP errors so clients report them at connect.
    if (error instanceof ApplicationError && error.code !== 'forbidden')
      return rpcError(message.id, -32602, error.message);
    throw error;
  }
};

/** No server-initiated stream: every answer comes back on its POST. */
export const mcpStreamHandler: Handler<MachineApp> = async () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });
