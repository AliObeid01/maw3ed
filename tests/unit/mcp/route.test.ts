import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPTIONS } from '@/app/api/mcp/route';
import { handleMcpRequest } from '@/server/mcp/protocol';
import { createLogger } from '@/server/http/logger';

afterEach(() => vi.unstubAllEnvs());

describe('OPTIONS /api/mcp', () => {
  it('is a 404 while the connector is off', async () => {
    vi.stubEnv('MCP_ENABLED', '');
    await expect(OPTIONS()).rejects.toMatchObject({ digest: expect.stringContaining('404') });
  });

  it('is a plain 204 with Allow: POST and no CORS headers while on', async () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('POST');
    expect([...res.headers.keys()].filter((h) => h.startsWith('access-control'))).toEqual([]);
  });
});

describe('protocol methods that need no database', () => {
  it('initialize, ping, server/discover and tools/list never reach the tool runner (no limiter, no Prisma)', async () => {
    const callTool = vi.fn();
    const env = { MCP_ENABLED: 'true', NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      handleMcpRequest(
        new Request('https://x.example/api/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
        { env, logger: createLogger({ level: 'silent' }), callTool: callTool as never },
      );
    const h = (m: string) => ({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': m });
    expect((await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).status).toBe(200);
    expect((await send({ jsonrpc: '2.0', id: 2, method: 'ping' })).status).toBe(200);
    expect((await send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).status).toBe(200);
    expect((await send({ jsonrpc: '2.0', id: 4, method: 'server/discover', params: { _meta: meta } }, h('server/discover'))).status).toBe(200);
    expect((await send({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: meta } }, h('tools/list'))).status).toBe(200);
    expect(callTool).not.toHaveBeenCalled();
  });
});
