import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sheet } from '@/components/ui/Sheet';

const html = (props: Partial<Omit<Parameters<typeof Sheet>[0], 'children'>> = {}) =>
  renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop -- createElement's typings need children in props here
    createElement(Sheet, {
      open: true,
      onOpenChange: () => {},
      title: 'More',
      closeLabel: 'Close',
      inline: true,
      children: createElement('p', null, 'body'),
      ...props,
    }),
  );

describe('Sheet', () => {
  // Radix adds aria-labelledby / aria-describedby on the client after mount, so a server render can
  // only prove the title and description elements exist inside the dialog (with ids to point at).
  it('renders a dialog containing a title heading', () => {
    const out = html();
    expect(out).toContain('role="dialog"');
    expect(out).toMatch(/<h2 id="[^"]+"[^>]*>More<\/h2>/);
    expect(out.indexOf('role="dialog"')).toBeLessThan(out.indexOf('<h2'));
  });

  it('keeps a title that is visually hidden available to screen readers', () => {
    expect(html({ hideTitle: true })).toMatch(/<h2[^>]*class="[^"]*sr-only[^"]*"[^>]*>More<\/h2>/);
  });

  it('labels the close button', () => {
    expect(html()).toContain('aria-label="Close"');
  });

  it('only references a description when one is given', () => {
    const without = html();
    expect(without).not.toMatch(/aria-describedby=/);
    expect(without).not.toMatch(/<p id=/);
    const withDesc = html({ description: 'Pick one' });
    expect(withDesc).toMatch(/<p id="[^"]+"[^>]*>Pick one<\/p>/);
  });

  it('renders nothing when closed', () => {
    expect(html({ open: false })).not.toContain('role="dialog"');
  });
});
