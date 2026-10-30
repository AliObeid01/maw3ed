/* eslint-disable @typescript-eslint/no-explicit-any -- OpenAPI document and route modules are walked dynamically */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@/server/contracts';
import { call, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

/**
 * NFR-02: for EVERY operation in the OpenAPI registry, an unknown body field, a non-object body and an
 * unknown query parameter answer 400 with `error.fields`, never 200/500. Walks the registry, so a newly
 * registered route is covered automatically (and fails here if it forgot `.strict()`).
 */
const routes = import.meta.glob('/src/app/api/**/route.ts') as Record<
  string,
  () => Promise<Record<string, (req: Request, args?: any) => Promise<Response>>>
>;
const CRON = 'validation-cron-secret-0123456789';
const FAKE_ID = 'c0123456789abcdefghijklmn'; // looks like a cuid; nothing exists behind it
const FAKE_TOKEN = 'abcdefghij.abcdefghij';

interface Op {
  method: string;
  path: string;
  hasBody: boolean;
  queryNames: string[];
  paramNames: string[];
  cron: boolean;
  secured: boolean;
}

function operations(): Op[] {
  const doc: any = buildOpenApiDocument();
  const ops: Op[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths))
    for (const [method, op] of Object.entries<any>(item)) {
      const params: any[] = op.parameters ?? [];
      ops.push({
        method,
        path,
        hasBody: Boolean(op.requestBody),
        queryNames: params.filter((p) => p.in === 'query').map((p) => p.name),
        paramNames: params.filter((p) => p.in === 'path').map((p) => p.name),
        cron: JSON.stringify(op.security ?? []).includes('cronSecret'),
        secured: Boolean(op.security?.length),
      });
    }
  return ops;
}

const filePath = (apiPath: string) =>
  `/src/app${apiPath.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`;

let cookie: string;
const OPS = operations();

beforeAll(async () => {
  await setupSchema();
  const pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  await pg.end();
  process.env.CRON_SECRET = CRON;
  cookie = (await signup()).cookie;
});
afterAll(() => {});

async function invoke(op: Op, opts: { body?: unknown; query?: Record<string, string> }) {
  const loader = routes[filePath(op.path)];
  if (!loader) throw new Error(`no route file for ${op.method} ${op.path}`);
  const handler = (await loader())[op.method.toUpperCase()];
  if (!handler) throw new Error(`route ${op.path} has no ${op.method.toUpperCase()} handler`);
  const params = Object.fromEntries(
    op.paramNames.map((n) => [n, n === 'token' ? FAKE_TOKEN : n === 'slug' ? 'no-such-biz' : FAKE_ID]),
  );
  const concretePath = op.path.replace(/\{(\w+)\}/g, (_, n) => params[n]!);
  return call(handler as any, concretePath, {
    method: op.method.toUpperCase(),
    cookie: op.secured && !op.cron ? cookie : undefined,
    // A valid Idempotency-Key everywhere (booking routes demand one) so the BODY is what gets rejected.
    headers: { 'idempotency-key': 'validation-test-key-1', ...(op.cron ? { 'x-cron-secret': CRON } : {}) },
    params,
    ...opts,
  });
}

const expect400 = (res: Awaited<ReturnType<typeof invoke>>) => {
  expect(res.status).toBe(400);
  expect(res.body?.error?.code).toBe('VALIDATION_FAILED');
  expect(res.body?.error?.fields).toBeTypeOf('object');
  expect(Object.keys(res.body!.error.fields).length).toBeGreaterThan(0);
};

describe('every registered route rejects bad input with 400 + fields', () => {
  it('the registry is non-trivial and every operation maps to a route file', () => {
    expect(OPS.length).toBeGreaterThan(50);
    for (const op of OPS) expect(routes[filePath(op.path)], `${op.method} ${op.path}`).toBeDefined();
  });

  const withBody = OPS.filter((o) => o.hasBody);
  it.each(withBody.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    'unknown body field: %s',
    async (_name, op) => {
      const res = await invoke(op, { body: { __unknown_field__: 1 } });
      expect400(res);
      // The unknown key itself is reported, not just some other missing field.
      expect(res.body!.error.fields.__unknown_field__).toBe('Unknown field.');
    },
  );
  it.each(withBody.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    'body that is not an object: %s',
    async (_name, op) => {
      expect400(await invoke(op, { body: [1, 2, 3] }));
    },
  );

  const withQuery = OPS.filter((o) => o.queryNames.length > 0 || o.cron);
  it.each(withQuery.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    'unknown query parameter: %s',
    async (_name, op) => {
      expect400(await invoke(op, { query: { __unknown_param__: '1' } }));
    },
  );
});
