import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PasswordField, PasswordStrength } from '@/components/auth/PasswordField';
import { AuthTabs } from '@/components/auth/AuthTabs';
import { Input } from '@/components/ui/Field';
import { render } from '../ui/helpers';

describe('Input endAdornment', () => {
  it('renders the adornment inside the field, reserves padding and shares the input direction', () => {
    const out = render(
      createElement(Input, {
        label: 'Name',
        type: 'email',
        endAdornment: createElement('button', { type: 'button' }, 'x'),
      }),
    );
    expect(out).toContain('<div class="relative" dir="ltr">');
    expect(out).toContain('pe-14');
    expect(out).toMatch(/absolute end-1[^"]*"><button/);
  });

  it('adds no wrapper without an adornment', () => {
    expect(render(createElement(Input, { label: 'Name' }))).not.toContain('relative');
  });
});

describe('PasswordField', () => {
  const html = render(
    createElement(PasswordField, {
      label: 'Password',
      autoComplete: 'new-password',
      error: 'Too short',
    }),
  );

  it('is a labelled LTR password input with the right autocomplete', () => {
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('dir="ltr"');
    expect(html).toMatch(/<label for="([^"]+)"/);
    expect(html).toContain('aria-invalid="true"');
  });

  it('has an accessible 44 px show toggle', () => {
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('size-11');
    expect(html).toContain('type="button"');
  });
});

describe('PasswordStrength', () => {
  it('warns when too short and shows the neutral hint when empty', () => {
    expect(render(createElement(PasswordStrength, { id: 's', password: 'abc' }))).toContain(
      'Too short: use at least 10 characters',
    );
    const empty = render(createElement(PasswordStrength, { id: 's', password: '' }));
    expect(empty).not.toContain('Too short');
    expect(empty).toContain('Use at least 10 characters.');
  });

  it('reports strong for a long passphrase', () => {
    expect(
      render(createElement(PasswordStrength, { id: 's', password: 'a long passphrase here' })),
    ).toContain('>Strong<');
  });
});

describe('AuthTabs', () => {
  it('marks only the current tab with aria-current and links to both routes', () => {
    const out = render(createElement(AuthTabs, { active: 'signup' }));
    expect(out).toContain('href="/login"');
    expect(out).toContain('href="/signup"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>Sign up</);
  });
});
