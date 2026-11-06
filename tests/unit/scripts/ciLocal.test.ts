import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script helper, no type declarations
import * as ci from '../../../scripts/lib/ciLocal.mjs';

type Step = { id: string; cmd: string; env?: Record<string, string> };

describe('ci-local: step list', () => {
  it('mirrors the checks job of ci.yml in the same order', () => {
    const ids = ci.buildSteps({ e2e: false }).map((s: Step) => s.id);
    expect(ids).toEqual([
      'lint',
      'typecheck',
      'unit',
      'db-up',
      'integration',
      'build',
      'openapi',
      'i18n',
      'contrast',
      'db-drop',
    ]);
  });

  it('adds the CI Playwright projects only with --e2e', () => {
    const steps: Step[] = ci.buildSteps({ e2e: true });
    const cmds = steps.filter((s) => s.id.startsWith('e2e')).map((s) => s.cmd);
    expect(cmds).toEqual([
      'pnpm exec playwright test --project=mobile --project=dashboard-mobile',
      'pnpm exec playwright test --project=dashboard-desktop tests/e2e/dashboard/shell.spec.ts',
    ]);
  });

  it('runs integration tests in the dedicated scratch schema', () => {
    const s: Step = ci.buildSteps({ e2e: false }).find((x: Step) => x.id === 'integration');
    expect(s.env?.ITEST_SCHEMA).toBe('itest_cilocal');
  });
});

describe('ci-local: argument parsing', () => {
  it('defaults', () => {
    expect(ci.parseArgs([])).toMatchObject({ dryRun: false, keepGoing: false, e2e: false, only: null, help: false });
  });
  it('flags and --only list', () => {
    const a = ci.parseArgs(['--dry-run', '--keep-going', '--e2e', '--only', 'lint,typecheck']);
    expect(a).toMatchObject({ dryRun: true, keepGoing: true, e2e: true, only: ['lint', 'typecheck'] });
  });
  it('ignores a leading -- and rejects unknown flags and step ids', () => {
    expect(ci.parseArgs(['--', '--help']).help).toBe(true);
    expect(() => ci.parseArgs(['--nope'])).toThrow(/Unknown option/);
    expect(() => ci.parseArgs(['--only', 'bogus'])).toThrow(/Unknown step/);
  });
});

describe('ci-local: plan selection', () => {
  it('--only integration pulls in the database start and the scratch-schema drop', () => {
    const ids = ci.selectSteps(ci.buildSteps({ e2e: false }), ['integration']).map((s: Step) => s.id);
    expect(ids).toEqual(['db-up', 'integration', 'db-drop']);
  });
  it('--only lint,typecheck selects just those', () => {
    const ids = ci.selectSteps(ci.buildSteps({ e2e: false }), ['lint', 'typecheck']).map((s: Step) => s.id);
    expect(ids).toEqual(['lint', 'typecheck']);
  });
});

describe('ci-local: localhost guard', () => {
  it('accepts localhost and 127.0.0.1 and unset values', () => {
    expect(ci.assertLocalDatabases({ DATABASE_URL: 'postgresql://u:p@localhost:5432/x' })).toBeUndefined();
    expect(ci.assertLocalDatabases({ DATABASE_URL_TEST: 'postgresql://u:p@127.0.0.1/x' })).toBeUndefined();
    expect(ci.assertLocalDatabases({})).toBeUndefined();
  });
  it('refuses a remote host, naming the variable but not the credentials', () => {
    let msg = '';
    try {
      ci.assertLocalDatabases({ DATABASE_URL: 'postgresql://user:secretpw@ep-x.neon.tech/db' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).not.toMatch(/secretpw/);
  });
  it('refuses look-alike hosts and allows the IPv6 loopback', () => {
    expect(() => ci.assertLocalDatabases({ DATABASE_URL: 'postgresql://localhost@neon.tech/db' })).toThrow(/DATABASE_URL/);
    expect(() => ci.assertLocalDatabases({ DATABASE_URL: 'postgresql://u:p@localhost.evil.com/db' })).toThrow(/DATABASE_URL/);
    expect(ci.assertLocalDatabases({ DATABASE_URL: 'postgresql://u:p@[::1]:5432/db' })).toBeUndefined();
  });
  it('refuses an unparsable value', () => {
    expect(() => ci.assertLocalDatabases({ DIRECT_URL: 'not a url' })).toThrow(/DIRECT_URL/);
  });
  it('the throwaway env is local-only', () => {
    expect(() => ci.assertLocalDatabases(ci.CI_ENV)).not.toThrow();
  });
});

describe('ci-local: --skip-int (light mode for agents)', () => {
  it('parses the flag and defaults to off', () => {
    expect(ci.parseArgs([]).skipInt).toBe(false);
    expect(ci.parseArgs(['--skip-int']).skipInt).toBe(true);
    expect(ci.parseArgs(['--', '--skip-int', '--keep-going'])).toMatchObject({ skipInt: true, keepGoing: true });
  });

  it('drops the database start, the integration run and the scratch-schema drop, keeps everything else in order', () => {
    const full = ci.buildSteps({ e2e: false }).map((s: Step) => s.id);
    const light = ci.buildSteps({ e2e: false, skipInt: true }).map((s: Step) => s.id);
    expect(light).toEqual(full.filter((id: string) => !['db-up', 'integration', 'db-drop'].includes(id)));
    expect(light).toEqual(['lint', 'typecheck', 'unit', 'build', 'openapi', 'i18n', 'contrast']);
  });

  it('is still the default plan without the flag, and --e2e steps survive it', () => {
    expect(ci.buildSteps({ e2e: false }).map((s: Step) => s.id)).toContain('integration');
    expect(ci.buildSteps({ e2e: true, skipInt: true }).map((s: Step) => s.id)).toEqual(
      expect.arrayContaining(['e2e-mobile', 'e2e-desktop']),
    );
  });

  it('refuses to combine --skip-int with an explicit integration selection', () => {
    expect(() => ci.parseArgs(['--skip-int', '--only', 'integration'])).toThrow(/skip-int/);
    expect(ci.parseArgs(['--skip-int', '--only', 'lint']).only).toEqual(['lint']);
  });

  it('the help text documents it', () => {
    expect(ci.HELP).toContain('--skip-int');
  });
});
