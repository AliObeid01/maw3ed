import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTimeoutMessage,
  buildTimeoutMinutes,
} from '../../../scripts/lib/buildTimeout.mjs';
import { cleanSourceMaps, findPublicSourceMapLeaks } from '../../../scripts/lib/cleanSourcemaps.mjs';

describe('build timeout guard', () => {
  it('defaults to 25 minutes and is never required', () => {
    expect(buildTimeoutMinutes({})).toBe(25);
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: '' })).toBe(25);
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: 'abc' })).toBe(25);
  });
  it('is clamped to 5..40', () => {
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: '1' })).toBe(5);
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: '-3' })).toBe(5);
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: '12' })).toBe(12);
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: '999' })).toBe(40);
    expect(buildTimeoutMinutes({ BUILD_TIMEOUT_MINUTES: 'Infinity' })).toBe(25);
  });
  it('the message names the minutes and the way out', () => {
    const m = buildTimeoutMessage(25);
    expect(m).toContain('25 minutes');
    expect(m).toContain('unset SENTRY_AUTH_TOKEN');
  });
});

describe('source map sweep never throws', () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tmp = () => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maw3ed-guard-')));
  const w = (rel: string, text: string) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };

  it('a non-existent .next is a quiet no-op', () => {
    tmp();
    const missing = path.join(dir, '.next');
    expect(cleanSourceMaps(missing)).toEqual({ deleted: 0, stripped: 0, skipped: 0 });
    expect(findPublicSourceMapLeaks(missing)).toEqual([]);
  });

  it('a directory named like a .js file is ignored', () => {
    tmp();
    fs.mkdirSync(path.join(dir, 'static/chunks/odd.js'), { recursive: true });
    w('static/chunks/a.js', 'x\n//# sourceMappingURL=a.js.map\n');
    expect(() => cleanSourceMaps(dir)).not.toThrow();
    expect(findPublicSourceMapLeaks(dir)).toEqual([]);
  });

  it('an unreadable file is skipped and counted, in both functions', () => {
    tmp();
    w('static/chunks/a.js', 'x');
    w('static/chunks/b.js', 'y\n//# sourceMappingURL=b.js.map\n');
    const failing = {
      ...fs,
      readFileSync: (f: string, ...rest: unknown[]) => {
        if (String(f).endsWith('a.js')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        return (fs.readFileSync as (...a: unknown[]) => unknown)(f, ...rest);
      },
    };
    expect(cleanSourceMaps(dir, failing)).toEqual({ deleted: 0, stripped: 1, skipped: 1 });
    expect(findPublicSourceMapLeaks(dir, failing)).toEqual([]);
  });

  it('a file that vanishes mid-scan does not throw', () => {
    tmp();
    w('static/chunks/a.js', 'x\n//# sourceMappingURL=a.js.map\n');
    w('static/chunks/a.js.map', '{}');
    const vanishing = {
      ...fs,
      readFileSync: () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      rmSync: () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    };
    expect(() => cleanSourceMaps(dir, vanishing)).not.toThrow();
    expect(() => findPublicSourceMapLeaks(dir, vanishing)).not.toThrow();
  });

  it('a listing that throws is survived', () => {
    tmp();
    const broken = {
      ...fs,
      readdirSync: () => {
        throw new Error('boom');
      },
    };
    expect(cleanSourceMaps(dir, broken)).toEqual({ deleted: 0, stripped: 0, skipped: 0 });
    expect(findPublicSourceMapLeaks(dir, broken)).toEqual([]);
  });
});
