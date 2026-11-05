import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Input, describedByIds } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { render } from './helpers';

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
  const select = (props: Partial<Parameters<typeof Select>[0]> = {}) =>
    render(
      createElement(Select, {
        id: 'svc',
        label: 'Service',
        value: 'cut',
        onChange: () => {},
        options: [
          { value: 'cut', label: 'Haircut' },
          { value: 'dry', label: 'Blow-dry' },
        ],
        ...props,
      }),
    );

  it('shares the same label and describedby wiring', () => {
    const out = select({ hint: 'Change later', 'aria-describedby': 'extra' });
    expect(out).toMatch(/<label for="svc"/);
    expect(attr(out, 'button', 'aria-describedby')).toBe('svc-hint extra');
  });

  it('is a collapsed select-only combobox showing the chosen label', () => {
    const out = select();
    expect(attr(out, 'button', 'role')).toBe('combobox');
    expect(attr(out, 'button', 'aria-haspopup')).toBe('listbox');
    expect(attr(out, 'button', 'aria-expanded')).toBe('false');
    expect(out).toContain('>Haircut<');
    expect(out).not.toContain('role="listbox"');
  });

  it('shows the placeholder when nothing matches and flags errors and required', () => {
    const out = select({ value: '', placeholder: 'Choose a service', error: 'Required', required: true });
    expect(out).toContain('>Choose a service<');
    expect(attr(out, 'button', 'aria-invalid')).toBe('true');
    expect(attr(out, 'button', 'aria-required')).toBe('true');
    expect(attr(out, 'button', 'aria-describedby')).toBe('svc-error');
  });

  it('puts the name on the field and renders a disabled button', () => {
    const out = select({ name: 'service', disabled: true });
    expect(attr(out, 'button', 'name')).toBe('service');
    expect(out).toMatch(/<button[^>]* disabled/);
  });
});

describe('describedByIds', () => {
  it('returns undefined when there is nothing to reference', () => {
    expect(describedByIds('x', undefined, undefined, undefined)).toBeUndefined();
  });
});
