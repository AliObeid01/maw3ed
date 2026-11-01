import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { INTL_SCOPES, namespacesFor, pickMessages, type IntlScope } from '@/i18n/scopes';

const SRC = path.resolve(import.meta.dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|ts)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return undefined;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return undefined;
}

const textCache = new Map<string, string>();
const read = (file: string) => {
  let text = textCache.get(file);
  if (text === undefined) {
    // Type-only imports are erased, so they put nothing in the bundle.
    text = fs
      .readFileSync(file, 'utf8')
      .replace(/import\s+type\s+[^;]*?from\s+['"][^'"]+['"]/g, '');
    textCache.set(file, text);
  }
  return text;
};

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/** Walks the import graph from a route group's files; a file is client code once a 'use client' file is above it. */
function clientNamespaces(entries: string[]) {
  const used = new Map<string, Set<string>>(); // namespace -> files
  const dynamic: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string, parentClient: boolean) => {
    const text = read(file);
    const client = parentClient || /^\s*(['"])use client\1/.test(text);
    const key = `${file}|${client}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (client) {
      for (const m of text.matchAll(/useTranslations\(\s*([^)]*)\)/g)) {
        const arg = m[1]!.trim();
        const lit = /^(['"])([^'"`$]+)\1$/.exec(arg);
        if (!lit) {
          if (arg) dynamic.push(`${path.relative(SRC, file)}: useTranslations(${arg})`);
          continue;
        }
        const ns = lit[2]!;
        used.set(ns, (used.get(ns) ?? new Set()).add(path.relative(SRC, file)));
      }
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1]!);
      if (target) visit(target, client);
    }
  };
  for (const e of entries) visit(e, false);
  return { used, dynamic };
}

const app = path.join(SRC, 'app');
const under = (dir: string) => walk(path.join(app, dir));
const GROUPS: Record<Exclude<IntlScope, 'dev'>, string[]> = {
  root: [path.join(app, 'page.tsx'), path.join(app, 'not-found.tsx')],
  public: under('(public)'),
  auth: under('(auth)'),
  app: under('app'),
};

describe('route-group message scopes (F11)', () => {
  for (const [scope, entries] of Object.entries(GROUPS)) {
    it(`${scope}: every namespace a client component uses is provided`, { timeout: 30_000 }, () => {
      const { used, dynamic } = clientNamespaces(entries);
      expect(dynamic, 'computed namespaces cannot be checked; use a string literal').toEqual([]);
      const provided: readonly string[] = INTL_SCOPES[scope as keyof typeof INTL_SCOPES];
      const covered = (ns: string) => provided.some((p) => ns === p || ns.startsWith(`${p}.`));
      const missing = [...used].filter(([ns]) => !covered(ns));
      expect(
        missing.map(([ns, files]) => `${ns} (used by ${[...files].join(', ')})`),
        `scope "${scope}" must list these namespaces in src/i18n/scopes.ts`,
      ).toEqual([]);
    });
  }

  it('every listed namespace exists in messages/en.json', () => {
    for (const list of Object.values(INTL_SCOPES))
      for (const ns of list) expect(Object.keys(en)).toContain(ns.split('.')[0]);
  });

  it('dev.* and the server-only email namespace never reach a production scope', () => {
    for (const list of Object.values(INTL_SCOPES)) {
      expect(list).not.toContain('dev');
      expect(list).not.toContain('email');
    }
    expect(namespacesFor('dev')).toBe('all');
  });

  it('the dev scope is only used by the (dev) layout, which 404s in production', () => {
    const users = walk(app).filter((f) => /scope="dev"/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(app, f).replaceAll('\\', '/'))).toEqual([
      '(dev)/layout.tsx',
    ]);
    expect(fs.readFileSync(path.join(app, '(dev)/layout.tsx'), 'utf8')).toMatch(
      /NODE_ENV === 'production'\) notFound\(\)/,
    );
  });
});

describe('pickMessages', () => {
  it('keeps only the listed top-level namespaces', () => {
    const picked = pickMessages(en, namespacesFor('public'));
    expect(Object.keys(picked).sort()).toEqual(
      [...new Set(INTL_SCOPES.public.map((n) => n.split('.')[0]))].sort(),
    );
    expect('dev' in picked).toBe(false);
    // Only the shared branch of `app`, not the 24 KB dashboard namespace.
    expect(Object.keys((picked as { app: object }).app)).toEqual(['format']);
  });
});
