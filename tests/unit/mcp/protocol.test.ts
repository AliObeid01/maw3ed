import { describe, expect, it, vi } from 'vitest';
import {
  handleMcpRequest,
  MAX_BODY_BYTES,
  originAllowed,
  SUPPORTED_VERSIONS,
  type McpHandlerDeps,
} from '@/server/mcp/protocol';
import { listTools, TOOL_NAMES, UnknownToolError } from '@/server/mcp/tools';
import { createLogger } from '@/server/http/logger';

const URL_ = 'https://maw3ed.example/api/mcp';
const ON = { MCP_ENABLED: 'true', NODE_ENV: 'test', APP_URL: 'https://maw3ed.example' } as NodeJS.ProcessEnv;

const fakeCall = vi.fn(async (name: string, args: unknown) => {
  if (name === 'nope') throw new UnknownToolError(name);
  return { content: [{ type: 'text' as const, text: `ran ${name}` }], structuredContent: { args } };
});

function deps(env: NodeJS.ProcessEnv = ON): McpHandlerDeps {
  return { env, logger: createLogger({ level: 'silent' }), callTool: fakeCall as never };
}

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
const modernHeaders = (method: string, name?: string) => ({
  'mcp-protocol-version': '2026-07-28',
  'mcp-method': method,
  ...(name ? { 'mcp-name': name } : {}),
});
const modern = (method: string, params: Record<string, unknown> = {}, id = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  params: { ...params, _meta: META },
});

async function json(res: Response) {
  return (await res.json()) as {
    id: unknown;
    result?: Record<string, unknown>;
    error?: { code: number; message: string; data?: Record<string, unknown> };
  };
}

describe('kill switch and transport rules', () => {
  it.each([undefined, '', 'false', 'TRUE', 'True', '1', ' true', 'true '])(
    'MCP_ENABLED=%j answers 404 to every method',
    async (value) => {
      const env = { ...ON, MCP_ENABLED: value } as NodeJS.ProcessEnv;
      for (const method of ['POST', 'GET', 'DELETE']) {
        const res = await handleMcpRequest(
          new Request(URL_, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }),
          deps(env),
        );
        expect(res.status).toBe(404);
      }
    },
  );

  it('GET and DELETE answer 405 with Allow: POST', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await handleMcpRequest(new Request(URL_, { method }), deps());
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('every answer is no-store', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), deps());
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a non-JSON content type with 415', async () => {
    const res = await handleMcpRequest(
      new Request(URL_, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }),
      deps(),
    );
    expect(res.status).toBe(415);
  });

  it('rejects a body over 64 KB with 413 (declared and actual)', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 10);
    const res = await handleMcpRequest(post(undefined, {}, big), deps());
    expect(res.status).toBe(413);
    const declared = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) },
      body: '{}',
    });
    expect((await handleMcpRequest(declared, deps())).status).toBe(413);
  });

  it('invalid JSON is -32700 with HTTP 400', async () => {
    const res = await handleMcpRequest(post(undefined, {}, '{nope'), deps());
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(-32700);
  });

  it('a batch array is rejected with -32600', async () => {
    const res = await handleMcpRequest(post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), deps());
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(-32600);
  });

  it('a non JSON-RPC object is -32600', async () => {
    const res = await handleMcpRequest(post({ hello: 'world' }), deps());
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(-32600);
  });

  it('a notification gets 202 and no body', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      deps(),
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('never issues a session id', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
      deps(),
    );
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });
});

describe('Origin rules', () => {
  const o = (origin: string) => post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin });

  it('no Origin header is allowed (Anthropic connects server-side)', async () => {
    expect((await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), deps())).status).toBe(200);
  });

  it('allows claude.ai, claude.com, the site origin and MCP_ALLOWED_ORIGINS', async () => {
    const env = { ...ON, MCP_ALLOWED_ORIGINS: 'https://tools.example, https://other.example' };
    for (const origin of [
      'https://claude.ai',
      'https://claude.com',
      'https://maw3ed.example',
      'https://tools.example',
      'https://other.example',
    ])
      expect((await handleMcpRequest(o(origin), deps(env))).status, origin).toBe(200);
  });

  it('rejects any other origin, "null" and garbage with 403', async () => {
    for (const origin of ['https://evil.example', 'null', 'not a url', 'https://claude.ai.evil.example', 'http://claude.ai'])
      expect((await handleMcpRequest(o(origin), deps())).status, origin).toBe(403);
  });

  it('localhost is allowed outside production only', () => {
    expect(originAllowed('http://localhost:3000', { ...ON, NODE_ENV: 'development' })).toBe(true);
    expect(originAllowed('http://localhost:3000', { ...ON, NODE_ENV: 'production' })).toBe(false);
    expect(originAllowed('https://localhost:3000', { ...ON, NODE_ENV: 'development' })).toBe(false);
  });
});

describe('legacy flow (what Claude speaks today)', () => {
  it('initialize returns the negotiated version, capabilities and serverInfo', async () => {
    const res = await handleMcpRequest(
      post({
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.id).toBe(7);
    expect(body.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'maw3ed' },
    });
    expect(body.result).not.toHaveProperty('resultType');
  });

  it('initialize with an unknown version negotiates the latest legacy one', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }),
      deps(),
    );
    expect((await json(res)).result?.protocolVersion).toBe('2025-11-25');
  });

  it('ping, tools/list and tools/call work, also with a legacy MCP-Protocol-Version header', async () => {
    const h = { 'mcp-protocol-version': '2025-11-25' };
    expect((await json(await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, h), deps()))).result).toEqual({});
    const list = await json(await handleMcpRequest(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h), deps()));
    expect((list.result?.tools as unknown[]).length).toBe(9);
    expect(list.result).not.toHaveProperty('ttlMs');
    const call = await json(
      await handleMcpRequest(
        post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_business', arguments: { slug: 'a' } } }, h),
        deps(),
      ),
    );
    expect(call.result).toMatchObject({ content: [{ type: 'text', text: 'ran get_business' }] });
  });

  it('unknown method is 404 / -32601', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'resources/list' }), deps());
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe(-32601);
  });

  it('unknown tool is a JSON-RPC -32602 error, not a tool result', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } }),
      deps(),
    );
    expect((await json(res)).error?.code).toBe(-32602);
  });

  it('tools/call without a name is -32602', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }), deps());
    expect((await json(res)).error?.code).toBe(-32602);
  });
});

describe('2026-07-28 flow', () => {
  it('server/discover returns versions, capabilities, serverInfo, ttlMs and cacheScope', async () => {
    const res = await handleMcpRequest(
      post(modern('server/discover'), modernHeaders('server/discover')),
      deps(),
    );
    expect(res.status).toBe(200);
    const r = (await json(res)).result!;
    expect(r.resultType).toBe('complete');
    expect(r.supportedVersions).toEqual([...SUPPORTED_VERSIONS]);
    expect(r.supportedVersions).toContain('2026-07-28');
    expect(r.capabilities).toEqual({ tools: {} });
    expect((r._meta as Record<string, unknown>)['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'maw3ed' });
    expect(typeof r.ttlMs).toBe('number');
    expect(r.cacheScope).toBe('public');
  });

  it('tools/list: resultType, ttlMs, public cache scope and the nine tools in a fixed order', async () => {
    const run = async () =>
      (await json(await handleMcpRequest(post(modern('tools/list'), modernHeaders('tools/list')), deps()))).result!;
    const a = await run();
    const b = await run();
    expect(a.resultType).toBe('complete');
    expect(a.ttlMs).toBeGreaterThan(0);
    expect(a.cacheScope).toBe('public');
    const names = (a.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      'search_businesses',
      'get_business',
      'get_free_times',
      'prepare_booking',
      'create_booking',
      'join_waitlist',
      'get_booking',
      'confirm_booking',
      'cancel_booking',
    ]);
    expect(names).toEqual((b.tools as { name: string }[]).map((t) => t.name));
  });

  it('tools/call carries resultType and the tool result', async () => {
    const res = await handleMcpRequest(
      post(modern('tools/call', { name: 'search_businesses', arguments: {} }), modernHeaders('tools/call', 'search_businesses')),
      deps(),
    );
    const r = (await json(res)).result!;
    expect(r.resultType).toBe('complete');
    expect(r.content).toEqual([{ type: 'text', text: 'ran search_businesses' }]);
  });

  it('initialize does not exist in 2026: 404 / -32601', async () => {
    const res = await handleMcpRequest(post(modern('initialize'), modernHeaders('initialize')), deps());
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe(-32601);
  });

  it('a different Mcp-Method header than the body method is 400 / -32020', async () => {
    const res = await handleMcpRequest(post(modern('tools/list'), modernHeaders('ping')), deps());
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(-32020);
  });

  it('a missing Mcp-Method header is 400 / -32020', async () => {
    const res = await handleMcpRequest(
      post(modern('tools/list'), { 'mcp-protocol-version': '2026-07-28' }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(-32020);
  });

  it('Mcp-Name must equal params.name for tools/call (mismatch and missing)', async () => {
    const call = modern('tools/call', { name: 'get_business', arguments: {} });
    for (const headers of [modernHeaders('tools/call', 'cancel_booking'), modernHeaders('tools/call')]) {
      const res = await handleMcpRequest(post(call, headers), deps());
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe(-32020);
    }
  });

  it('the _meta protocolVersion must equal the header (mismatch and missing)', async () => {
    const wrong = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } };
    const none = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    for (const body of [wrong, none]) {
      const res = await handleMcpRequest(post(body, modernHeaders('tools/list')), deps());
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe(-32020);
    }
  });

  it('a 2026 body without the MCP-Protocol-Version header is 400 / -32020', async () => {
    const res = await handleMcpRequest(post(modern('tools/list'), { 'mcp-method': 'tools/list' }), deps());
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(-32020);
  });

  it('an unsupported version is 400 / -32022 and lists the supported ones', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '2099-01-01' }),
      deps(),
    );
    expect(res.status).toBe(400);
    const e = (await json(res)).error!;
    expect(e.code).toBe(-32022);
    expect(e.data?.supported).toEqual([...SUPPORTED_VERSIONS]);
  });
});

describe('tool definitions', () => {
  const tools = listTools();

  it('has the nine tools, names within limits, in the fixed order', () => {
    expect(TOOL_NAMES).toHaveLength(9);
    for (const t of tools) {
      expect(t.name).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it('every tool has a strict JSON Schema 2020-12 object schema and the four annotations', () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.inputSchema).not.toHaveProperty('$schema');
      expect(Object.keys(t.annotations).sort()).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint']);
    }
  });

  it('reads are readOnlyHint, writes are destructiveHint', () => {
    const writes = ['create_booking', 'join_waitlist', 'confirm_booking', 'cancel_booking'];
    for (const t of tools) {
      const isWrite = writes.includes(t.name);
      expect(t.annotations.readOnlyHint, t.name).toBe(!isWrite);
      expect(t.annotations.destructiveHint, t.name).toBe(isWrite);
    }
  });

  it('prepare_booking is a read (it writes nothing) and says the token lives 10 minutes', () => {
    const p = tools.find((t) => t.name === 'prepare_booking')!;
    expect(p.annotations.readOnlyHint).toBe(true);
    expect(p.description).toMatch(/10 minutes/);
  });

  it('descriptions are static facts: no directions to the model or to other tools beyond naming an input source', () => {
    for (const t of tools) {
      expect(t.description, t.name).not.toMatch(/\b(you must|you should|always|never|ignore|do not|don't|first call|then call)\b/i);
    }
  });
});
