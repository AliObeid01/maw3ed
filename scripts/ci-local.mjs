#!/usr/bin/env node
// Runs the CI `checks` job locally. See `pnpm ci:local -- --help` and docs/CI_LOCAL.md.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CI_ENV, HELP, assertLocalDatabases, buildSteps, parseArgs, selectSteps } from './lib/ciLocal.mjs';

const root = path.resolve(import.meta.dirname, '..');

function run(step) {
  return new Promise((resolve) => {
    const child = spawn(step.cmd, {
      cwd: root,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...CI_ENV, ...(step.env ?? {}) },
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

function gitCommit() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim() ? ' (uncommitted changes)' : '';
    return sha + dirty;
  } catch {
    return 'unknown';
  }
}

function writeSummary(results, args, totalMs) {
  const dir = path.join(root, '.ci-local');
  fs.mkdirSync(dir, { recursive: true });
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const lines = [
    '# Local CI summary',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Commit: ${gitCommit()}`,
    `- Node: ${process.version} on ${process.platform}`,
    `- Options: ${process.argv.slice(2).join(' ') || '(none)'}`,
    `- Result: ${failed === 0 ? 'PASS' : 'FAIL'} in ${fmt(totalMs)}`,
    '',
    '| Step | Result | Duration |',
    '| --- | --- | --- |',
    ...results.map((r) => `| ${r.title} | ${r.status} | ${r.ms === null ? '-' : fmt(r.ms)} |`),
    '',
  ];
  fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n'));
  return path.join('.ci-local', 'summary.md');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  assertLocalDatabases(process.env);
  const steps = selectSteps(buildSteps({ e2e: args.e2e }), args.only);

  console.log('Plan:');
  steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.id}] ${s.title}\n       ${s.cmd}`));
  if (args.dryRun) {
    console.log('\nDry run: nothing executed.');
    return 0;
  }

  const results = [];
  const started = Date.now();
  let failed = false;
  for (const step of steps) {
    if (failed && !args.keepGoing && !step.always) {
      results.push({ title: step.title, status: 'SKIPPED', ms: null });
      continue;
    }
    if (step.always && !results.some((r) => r.title.startsWith('Start local Postgres') && r.status === 'PASS')) {
      results.push({ title: step.title, status: 'SKIPPED', ms: null });
      continue;
    }
    console.log(`\n=== ${step.title} ===\n$ ${step.cmd}`);
    const t = Date.now();
    const code = await run(step);
    const ms = Date.now() - t;
    const ok = code === 0;
    if (!ok) failed = true;
    results.push({ title: step.title, status: ok ? 'PASS' : 'FAIL', ms });
    console.log(`--- ${ok ? 'PASS' : 'FAIL'} ${step.title} (${fmt(ms)})`);
  }

  const file = writeSummary(results, args, Date.now() - started);
  console.log('\nResult:');
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${r.title}${r.ms === null ? '' : ` (${fmt(r.ms)})`}`);
  console.log(`\nSummary written to ${file}`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(2);
  },
);
