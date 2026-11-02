#!/usr/bin/env node
// Owner-runnable security header check. No dependencies, never sends credentials.
//
//   node scripts/check-security-headers.mjs                       # https://maw3edlb.com
//   node scripts/check-security-headers.mjs https://preview.example.vercel.app
//   node scripts/check-security-headers.mjs http://localhost:4400 --no-hsts
//
// Prints PASS / FAIL per check per URL and exits 1 if anything fails.

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://maw3edlb.com').replace(/\/+$/, '');
const PAGES = ['/', '/login', '/signup', '/pricing', '/directory'];
const API = ['/api/health'];
// HSTS comes from Vercel on https; skip it for plain http (local) or with --no-hsts.
const checkHsts = !flags.has('--no-hsts') && base.startsWith('https://');

const REQUIRED = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

function directive(csp, name) {
  const part = csp.split(';').map((s) => s.trim()).find((s) => s === name || s.startsWith(`${name} `));
  return part ?? '';
}

function pageChecks(h) {
  const csp = h.get('content-security-policy') ?? '';
  const script = directive(csp, 'script-src');
  return [
    ['CSP present', csp !== ''],
    ['CSP has a nonce', /'nonce-[A-Za-z0-9+/=]{16,}'/.test(script)],
    ["CSP script-src has 'strict-dynamic'", script.includes("'strict-dynamic'")],
    ["CSP script-src has no 'unsafe-inline' / 'unsafe-eval'", script !== '' && !/'unsafe-(inline|eval)'/.test(script)],
    ...REQUIRED.map((d) => [`CSP has ${d}`, csp.split(';').map((s) => s.trim()).includes(d)]),
    ['CSP has no wildcard source', !/(^|\s)\*(\s|;|$)/.test(csp)],
    ...commonChecks(h),
  ];
}

function commonChecks(h) {
  return [
    ['X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY'],
    ['X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff'],
    ['Referrer-Policy set', ['strict-origin-when-cross-origin', 'no-referrer'].includes(h.get('referrer-policy') ?? '')],
    ['Permissions-Policy denies camera, microphone, geolocation', /camera=\(\)/.test(h.get('permissions-policy') ?? '') && /microphone=\(\)/.test(h.get('permissions-policy') ?? '') && /geolocation=\(\)/.test(h.get('permissions-policy') ?? '')],
    ['Cross-Origin-Opener-Policy: same-origin', h.get('cross-origin-opener-policy') === 'same-origin'],
    ['No X-Powered-By', h.get('x-powered-by') === null],
    ...(checkHsts ? [['Strict-Transport-Security (from Vercel)', /max-age=\d+/.test(h.get('strict-transport-security') ?? '')]] : []),
  ];
}

function apiChecks(h) {
  return [
    ["CSP default-src 'none'", (h.get('content-security-policy') ?? '').startsWith("default-src 'none'")],
    ...commonChecks(h),
  ];
}

async function nonceOf(url) {
  const r = await fetch(url, { redirect: 'manual', credentials: 'omit', headers: { 'user-agent': 'maw3ed-header-check' } });
  return { headers: r.headers, status: r.status };
}

let failures = 0;
const report = (path, rows) => {
  console.log(`\n${base}${path}`);
  for (const [name, ok] of rows) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures++;
  }
};

for (const path of [...PAGES, ...API]) {
  try {
    const { headers, status } = await nonceOf(base + path);
    if (status >= 500) {
      report(path, [[`responds (HTTP ${status})`, false]]);
      continue;
    }
    report(path, path.startsWith('/api/') ? apiChecks(headers) : pageChecks(headers));
  } catch (e) {
    report(path, [[`request failed: ${e instanceof Error ? e.message : e}`, false]]);
  }
}

// Two loads must carry different nonces.
try {
  const get = async () => /'nonce-([^']+)'/.exec((await nonceOf(`${base}/`)).headers.get('content-security-policy') ?? '')?.[1];
  const [a, b] = [await get(), await get()];
  report('/ (two loads)', [['nonce differs per request', Boolean(a && b && a !== b)]]);
} catch (e) {
  report('/ (two loads)', [[`request failed: ${e instanceof Error ? e.message : e}`, false]]);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
