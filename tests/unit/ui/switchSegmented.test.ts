import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { StickySaveBar } from '@/components/app/StickySaveBar';
import { activeIdFor } from '@/components/app/AppFrame';

const noop = () => undefined;

describe('Switch', () => {
  const html = (checked: boolean, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(Switch, { checked, onCheckedChange: noop, label: 'Haircut active', ...extra }),
    );

  it('is a labelled role=switch that reports its state', () => {
    const on = html(true);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-label="Haircut active"');
    expect(html(false)).toContain('aria-checked="false"');
  });

  it('uses flex alignment for the knob so it mirrors in RTL, and a 44 px hit area', () => {
    expect(html(true)).toContain('justify-end');
    expect(html(false)).toContain('justify-start');
    expect(html(true)).toContain('before:-inset-y-1.5');
    expect(html(true)).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });

  it('shows a busy state while pending and can be disabled', () => {
    expect(html(true, { pending: true })).toContain('aria-busy="true"');
    expect(html(true, { disabled: true })).toContain('disabled=""');
  });
});

describe('Segmented', () => {
  const html = (value: number) =>
    renderToStaticMarkup(
      createElement(Segmented<number>, {
        label: 'Time slots every',
        value,
        onChange: noop,
        options: [
          { value: 10, label: '10 min' },
          { value: 15, label: '15 min' },
          { value: 30, label: '30 min' },
        ],
      }),
    );

  it('is a radiogroup named by its label with the current value checked', () => {
    const out = html(15);
    expect(out).toMatch(/role="radiogroup" aria-labelledby="([^"]+)"/);
    const id = out.match(/aria-labelledby="([^"]+)"/)![1];
    expect(out).toContain(`id="${id}"`);
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-checked="true"[^>]*>15 min/);
  });

  it('keeps every segment at 44 px', () => {
    expect(html(10).match(/h-11/g)).toHaveLength(3);
  });
});

describe('StickySaveBar', () => {
  it('is phone-only and leaves room for the floating button on the end side', () => {
    const out = renderToStaticMarkup(createElement(StickySaveBar, null, 'x'));
    expect(out).toContain('md:hidden');
    expect(out).toContain('me-[72px]');
    expect(out).toContain('env(safe-area-inset-bottom)');
  });
});

describe('activeIdFor', () => {
  it('maps dashboard paths to the navigation entry', () => {
    expect(activeIdFor('/app')).toBe('today');
    expect(activeIdFor('/app/setup')).toBe('setup');
    expect(activeIdFor('/app/services')).toBe('services');
    expect(activeIdFor('/app/hours')).toBe('hours');
    expect(activeIdFor('/app/share')).toBe('share');
    expect(activeIdFor('/app/clients/abc')).toBe('clients');
    expect(activeIdFor('/app/book')).toBe('book');
  });

  it('falls back to Today for unknown paths and does not match on a shared prefix', () => {
    expect(activeIdFor('/app/unknown')).toBe('today');
    expect(activeIdFor('/app/staffing')).toBe('today');
  });
});
