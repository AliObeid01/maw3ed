import { notFound } from 'next/navigation';
import { isAssistantEnabled } from '@/lib/assistant';
import { handleMcpRequest } from '@/server/mcp/protocol';

export const dynamic = 'force-dynamic';

/**
 * The assistant connector (Model Context Protocol over Streamable HTTP, stateless, JSON answers). The one
 * route that does not use the `{ error: { code, message } }` envelope: protocol answers are JSON-RPC.
 * This file only hands the request to the protocol layer (src/server/mcp); it is NOT in the OpenAPI document.
 * Kill switch: `MCP_ENABLED=true`, read per request; anything else answers 404 for every method.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAssistantEnabled()) notFound();
  return handleMcpRequest(req);
}

/** GET and DELETE are session operations of older transports: 405 with `Allow: POST` (404 while disabled). */
const methodNotAllowed = async (req: Request): Promise<Response> => {
  if (!isAssistantEnabled()) notFound();
  return handleMcpRequest(req);
};
/** A plain 204 with `Allow: POST` and no CORS headers (no browser page may call this endpoint); 404 while off. */
export async function OPTIONS(): Promise<Response> {
  if (!isAssistantEnabled()) notFound();
  return new Response(null, { status: 204, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
