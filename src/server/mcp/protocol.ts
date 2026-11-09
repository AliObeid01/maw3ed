import { randomUUID } from 'node:crypto';
import { isAssistantEnabled } from '@/lib/assistant';
import { AppError } from '@/server/http/errors';
import { childLogger, type Logger } from '@/server/http/logger';
import { readLimitedText } from '@/server/http/withRoute';
import { reportError } from '@/server/observability/report';
import { callTool, listTools, UnknownToolError, type ToolResult } from './tools';

/**
 * The MCP endpoint's protocol layer (JSON-RPC 2.0 over Streamable HTTP, stateless, JSON answers, no SSE, no
 * session ids). Two eras are served from the one URL:
 *  - 2026-07-28: every POST carries MCP-Protocol-Version, Mcp-Method (and Mcp-Name for tools/call) that must
 *    match the body; `server/discover`; `resultType`, `ttlMs`, `cacheScope`.
 *  - legacy 2025-03-26 .. 2025-11-25 (what Claude's client still speaks): `initialize` handshake answered
 *    statelessly (no Mcp-Session-Id issued), `notifications/initialized` -> 202, `ping`, `tools/*`.
 * This file does protocol parsing and validation ONLY; tool execution is delegated to ./tools.
 */

export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [MODERN_VERSION, ...LEGACY_VERSIONS];
export const SERVER_INFO = { name: 'maw3ed', title: 'Maw3ed', version: '1.0.0' } as const;
export const MAX_BODY_BYTES = 64 * 1024;
export const TOOLS_TTL_MS = 5 * 60_000;

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

// JSON-RPC and MCP error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;
const FORBIDDEN_ORIGIN = -32001;

export interface McpHandlerDeps {
  env: NodeJS.ProcessEnv;
  logger?: Logger;
  /** Test seam; default: the real tool runner. */
  callTool?: typeof callTool;
}

type Id = string | number | null;

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

function rpcError(
  status: number,
  id: Id,
  code: number,
  message: string,
  requestId: string,
  data?: unknown,
  extra?: Record<string, string>,
) {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } },
    { status, headers: { ...BASE_HEADERS, 'x-request-id': requestId, ...extra } },
  );
}

function rpcResult(id: Id, result: Record<string, unknown>, requestId: string) {
  return Response.json(
    { jsonrpc: '2.0', id, result },
    { status: 200, headers: { ...BASE_HEADERS, 'x-request-id': requestId } },
  );
}

/** Origins that may call the endpoint when they send an Origin header. An absent Origin is always allowed. */
export function allowedOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const out = new Set(['https://claude.ai', 'https://claude.com']);
  const add = (value: string | undefined) => {
    if (!value) return;
    try {
      out.add(new URL(value.trim()).origin);
    } catch {
      /* ignore a malformed entry */
    }
  };
  add(env.APP_URL);
  for (const extra of (env.MCP_ALLOWED_ORIGINS ?? '').split(',')) add(extra);
  return out;
}

export function originAllowed(origin: string, env: NodeJS.ProcessEnv): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // "null" and garbage
  }
  if (allowedOrigins(env).has(parsed.origin)) return true;
  // Local development only: localhost on any port, never in production.
  return (
    env.NODE_ENV !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
    parsed.protocol === 'http:'
  );
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface RpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function discoverResult() {
  return {
    resultType: 'complete',
    supportedVersions: [...SUPPORTED_VERSIONS],
    capabilities: { tools: {} },
    _meta: { [META_SERVER_INFO]: SERVER_INFO },
    ttlMs: TOOLS_TTL_MS,
    cacheScope: 'public',
  };
}

async function handle(req: Request, deps: McpHandlerDeps): Promise<Response> {
  const env = deps.env;
  const incoming = req.headers.get('x-request-id');
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const logger = deps.logger ?? childLogger({ requestId });
  const run = deps.callTool ?? callTool;

  // Kill switch: indistinguishable from a missing route.
  if (!isAssistantEnabled(env))
    return new Response('Not Found', {
      status: 404,
      headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
    });

  if (req.method !== 'POST')
    return new Response(null, {
      status: 405,
      headers: { ...BASE_HEADERS, allow: 'POST', 'x-request-id': requestId },
    });

  const origin = req.headers.get('origin');
  if (origin !== null && !originAllowed(origin, env))
    return rpcError(403, null, FORBIDDEN_ORIGIN, 'This origin is not allowed.', requestId);

  if (!/^application\/json\s*(;|$)/i.test((req.headers.get('content-type') ?? '').trim()))
    return rpcError(415, null, INVALID_REQUEST, 'Send the request as application/json.', requestId);

  let text: string;
  try {
    text = await readLimitedText(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof AppError && error.status === 413)
      return rpcError(413, null, INVALID_REQUEST, 'The request body is too large (64 KB maximum).', requestId);
    throw error;
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rpcError(400, null, PARSE_ERROR, 'The body is not valid JSON.', requestId);
  }
  if (Array.isArray(body))
    return rpcError(400, null, INVALID_REQUEST, 'Batch requests are not supported. Send one request per POST.', requestId);
  if (
    !isRecord(body) ||
    body.jsonrpc !== '2.0' ||
    typeof body.method !== 'string' ||
    (body.id !== undefined && body.id !== null && typeof body.id !== 'string' && typeof body.id !== 'number') ||
    (body.params !== undefined && !isRecord(body.params))
  )
    return rpcError(400, null, INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request.', requestId);

  const rpc = body as unknown as RpcRequest;
  const hasId = rpc.id !== undefined && rpc.id !== null;
  const id: Id = hasId ? (rpc.id as Id) : null;

  // A notification gets no answer body.
  if (!hasId || rpc.method.startsWith('notifications/'))
    return new Response(null, { status: 202, headers: { ...BASE_HEADERS, 'x-request-id': requestId } });

  // ---- which era --------------------------------------------------------------------------------------
  const headerVersion = req.headers.get('mcp-protocol-version');
  const meta = isRecord(rpc.params?._meta) ? (rpc.params._meta as Record<string, unknown>) : undefined;
  const metaVersion = typeof meta?.[META_VERSION] === 'string' ? (meta[META_VERSION] as string) : undefined;

  let modern = false;
  if (headerVersion !== null) {
    if (!SUPPORTED_VERSIONS.includes(headerVersion))
      return rpcError(
        400,
        id,
        UNSUPPORTED_VERSION,
        `Unsupported protocol version ${JSON.stringify(headerVersion.slice(0, 40))}. Supported: ${SUPPORTED_VERSIONS.join(', ')}.`,
        requestId,
        { supported: [...SUPPORTED_VERSIONS] },
      );
    modern = headerVersion === MODERN_VERSION;
  } else if (metaVersion !== undefined) {
    // A 2026-style body without the header it must carry.
    return rpcError(400, id, HEADER_MISMATCH, 'Missing the MCP-Protocol-Version header.', requestId);
  }

  if (modern) {
    const method = req.headers.get('mcp-method');
    const name = req.headers.get('mcp-name');
    const mismatch = (what: string) =>
      rpcError(400, id, HEADER_MISMATCH, `${what} does not match the request body.`, requestId);
    if (metaVersion !== MODERN_VERSION)
      return mismatch('MCP-Protocol-Version');
    if (method !== rpc.method) return mismatch('Mcp-Method');
    if (rpc.method === 'tools/call' && name !== rpc.params?.name) return mismatch('Mcp-Name');
  }

  const done = (result: Record<string, unknown>) =>
    rpcResult(id, modern ? { resultType: 'complete', ...result } : result, requestId);

  // ---- methods ----------------------------------------------------------------------------------------
  switch (rpc.method) {
    case 'initialize': {
      if (modern) break; // 2026 has no handshake: falls through to "unknown method"
      const asked = typeof rpc.params?.protocolVersion === 'string' ? rpc.params.protocolVersion : '';
      const negotiated = (LEGACY_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : LEGACY_VERSIONS[0];
      return rpcResult(
        id,
        { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo: SERVER_INFO },
        requestId,
      );
    }
    case 'ping':
      return done({});
    case 'server/discover':
      if (modern) return rpcResult(id, discoverResult(), requestId);
      break;
    case 'tools/list':
      return done({ tools: listTools(), ...(modern ? { ttlMs: TOOLS_TTL_MS, cacheScope: 'public' } : {}) });
    case 'tools/call': {
      const name = rpc.params?.name;
      if (typeof name !== 'string' || !name)
        return rpcError(200, id, INVALID_PARAMS, 'tools/call needs a tool name in params.name.', requestId);
      let result: ToolResult;
      try {
        result = await run(name, rpc.params?.arguments, { requestId, logger });
      } catch (error) {
        if (error instanceof UnknownToolError)
          return rpcError(200, id, INVALID_PARAMS, `Unknown tool: ${JSON.stringify(name.slice(0, 80))}.`, requestId);
        throw error;
      }
      return done({ ...result });
    }
    default:
  }
  return rpcError(404, id, METHOD_NOT_FOUND, `Method not found: ${JSON.stringify(rpc.method.slice(0, 80))}.`, requestId);
}

/** Entry point: never throws; an unexpected failure is a JSON-RPC -32603 with HTTP 500 and no detail. */
export async function handleMcpRequest(
  req: Request,
  deps: McpHandlerDeps = { env: process.env },
): Promise<Response> {
  try {
    return await handle(req, deps);
  } catch (error) {
    reportError(error, { route: '/api/mcp', method: req.method });
    return rpcError(
      500,
      null,
      -32603,
      'Maw3ed could not process this request. Try again in a minute.',
      randomUUID(),
    );
  }
}
