import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CountBadge } from '@/components/ui/CountBadge';

const html = (props: Parameters<typeof CountBadge>[0]) =>
  renderToStaticMarkup(createElement(CountBadge, props));

describe('CountBadge', () => {
  it('renders nothing for zero or negative counts', () => {
    expect(html({ count: 0 })).toBe('');
    expect(html({ count: -3 })).toBe('');
  });

  it('shows the number up to 99 and caps larger values', () => {
    expect(html({ count: 99 })).toContain('>99<');
    expect(html({ count: 100 })).toContain('>99+<');
  });

  it('hides the number from assistive tech and exposes the sr-only label instead', () => {
    const out = html({ count: 4, label: '4 reminders due' });
    expect(out).toMatch(/<span dir="ltr" aria-hidden="true">4<\/span>/);
    expect(out).toContain('<span class="sr-only">4 reminders due</span>');
  });

  it('leaves the number readable when there is no label', () => {
    expect(html({ count: 4 })).not.toContain('aria-hidden');
  });
});
