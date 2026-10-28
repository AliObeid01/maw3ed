import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Input, Select, describedByIds } from '@/components/ui/Field';

const input = (props: Partial<Parameters<typeof Input>[0]> = {}) =>
  renderToStaticMarkup(createElement(Input, { label: 'Full name', ...props }));
const attr = (html: string, tag: string, name: string) =>
  html.match(new RegExp(`<${tag}[^>]*? ${name}="([^"]*)"`))?.[1];

describe('Input', () => {
  it('associates the label with the control through htmlFor and id', () => {
    const out = input({ id: 'name' });
    expect(out).toMatch(/<label for="name"[^>]*>Full name<\/label>/);
    expect(attr(out, 'input', 'id')).toBe('name');
  });

  it('generates a matching id when none is given', () => {
    const out = input();
    const forId = out.match(/<label for="([^"]+)"/)![1];
    expect(attr(out, 'input', 'id')).toBe(forId);
  });

  it('wires aria-invalid and aria-describedby to the error message', () => {
    const out = input({ id: 'name', error: 'Required' });
    expect(attr(out, 'input', 'aria-invalid')).toBe('true');
    expect(attr(out, 'input', 'aria-describedby')).toBe('name-error');
    expect(out).toContain('<p id="name-error" role="alert"');
  });

  it('wires the hint when there is no error', () => {
    const out = input({ id: 'name', hint: 'As on your ID' });
    expect(attr(out, 'input', 'aria-describedby')).toBe('name-hint');
    expect(attr(out, 'input', 'aria-invalid')).toBeUndefined();
    expect(out).toContain('id="name-hint"');
  });

  it('merges a caller-supplied aria-describedby instead of dropping it', () => {
    const out = input({ id: 'name', error: 'Required', 'aria-describedby': 'help-text' });
    expect(attr(out, 'input', 'aria-describedby')).toBe('name-error help-text');
    expect(attr(input({ 'aria-describedby': 'help-text' }), 'input', 'aria-describedby')).toBe(
      'help-text',
    );
  });

  it('keeps phone and email data left-to-right', () => {
    expect(attr(input({ type: 'tel' }), 'input', 'dir')).toBe('ltr');
    expect(attr(input({ type: 'email' }), 'input', 'dir')).toBe('ltr');
    expect(attr(input({ type: 'text' }), 'input', 'dir')).toBeUndefined();
  });
});

describe('Select', () => {
  it('shares the same label and describedby wiring', () => {
    const out = renderToStaticMarkup(
      createElement(
        Select,
        { id: 'svc', label: 'Service', hint: 'Change later', 'aria-describedby': 'extra' },
        createElement('option', null, 'Haircut'),
      ),
    );
    expect(out).toMatch(/<label for="svc"/);
    expect(attr(out, 'select', 'aria-describedby')).toBe('svc-hint extra');
  });
});

describe('describedByIds', () => {
  it('returns undefined when there is nothing to reference', () => {
    expect(describedByIds('x', undefined, undefined, undefined)).toBeUndefined();
  });
});
