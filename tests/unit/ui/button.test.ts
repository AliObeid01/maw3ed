import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, ButtonLink } from '@/components/ui/Button';

const tag = (html: string) => html.match(/<(button|a)[^>]*>/)![0];

describe('Button', () => {
  it('keeps a loading button focusable: aria-disabled and aria-busy, not native disabled', () => {
    const el = tag(renderToStaticMarkup(createElement(Button, { loading: true }, 'Save')));
    expect(el).toContain('aria-busy="true"');
    expect(el).toContain('aria-disabled="true"');
    expect(el).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it('uses the native disabled attribute for the plain disabled prop', () => {
    const el = tag(renderToStaticMarkup(createElement(Button, { disabled: true }, 'Save')));
    expect(el).toMatch(/\sdisabled(=|\s|>)/);
    expect(el).not.toContain('aria-busy');
  });

  it('defaults to type=button so it never submits by accident', () => {
    expect(tag(renderToStaticMarkup(createElement(Button, null, 'Save')))).toContain(
      'type="button"',
    );
  });
});

describe('ButtonLink', () => {
  it('removes a disabled link from the tab order', () => {
    const el = tag(
      renderToStaticMarkup(createElement(ButtonLink, { href: '/x', 'aria-disabled': true }, 'Go')),
    );
    expect(el).toContain('tabindex="-1"');
  });

  it('leaves an enabled link tabbable', () => {
    const el = tag(renderToStaticMarkup(createElement(ButtonLink, { href: '/x' }, 'Go')));
    expect(el).not.toContain('tabindex');
  });
});
