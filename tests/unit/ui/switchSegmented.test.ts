import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { activeIdFor } from '@/components/app/AppFrame';
import { errorKey } from '@/lib/setup/errors';
import { ApiError } from '@/lib/api/auth';

// Behaviour is asserted through roles, names and ARIA state, not styling classes. Keyboard behaviour of the
// radio groups is covered in Playwright (tests/e2e/dashboard/a11y.spec.ts) because it needs a real DOM.
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

  it('is a real button that is not a submit button', () => {
    expect(html(true)).toMatch(/^<button[^>]*type="button"/);
  });

  it('reports busy while pending and is natively disabled when disabled', () => {
    expect(html(true, { pending: true })).toContain('aria-busy="true"');
    expect(html(true)).not.toContain('aria-busy');
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

  it('is a radiogroup named by its visible label with the current value checked', () => {
    const out = html(15);
    const id = out.match(/role="radiogroup" aria-labelledby="([^"]+)"/)![1];
    expect(out).toContain(`id="${id}"`);
    expect(out).toContain('Time slots every');
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-checked="true"[^>]*>15 min/);
  });

  it('uses one tab stop (roving tabindex): only the checked radio is focusable by Tab', () => {
    const out = html(15);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(out).toMatch(/aria-checked="true"[^>]*tabindex="0"/);
  });
});

describe('activeIdFor', () => {
  it('maps dashboard paths to the navigation entry', () => {
    expect(activeIdFor('/app')).toBe('today');
    expect(activeIdFor('/app/setup')).toBe('setup');
    expect(activeIdFor('/app/services')).toBe('services');
    expect(activeIdFor('/app/clients/abc')).toBe('clients');
    expect(activeIdFor('/app/book')).toBe('book');
  });

  it('falls back to Today for unknown paths and does not match on a shared prefix', () => {
    expect(activeIdFor('/app/unknown')).toBe('today');
    expect(activeIdFor('/app/staffing')).toBe('today');
  });
});

describe('errorKey for the new conflict', () => {
  it('maps ALREADY_MEMBER to its own key, ahead of the generic 409', () => {
    expect(errorKey(new ApiError(409, 'ALREADY_MEMBER', 'x'))).toBe('alreadyMember');
    expect(errorKey(new ApiError(409, 'SOMETHING_ELSE', 'x'))).toBe('generic');
  });
});
