import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalDraftNotice } from '@/components/legal/LegalDocument';
import { LEGAL_DRAFT } from '@/lib/site';

const render = (show: boolean) =>
  renderToStaticMarkup(createElement(LegalDraftNotice, { show, title: 'Draft - under review', body: 'Not reviewed by a lawyer.' }));

describe('LegalDraftNotice', () => {
  it('renders the Draft notice when the flag is true', () => {
    const html = render(true);
    expect(html).toContain('data-testid="legal-draft"');
    expect(html).toContain('Draft - under review');
  });
  it('renders nothing when the flag is false', () => {
    expect(render(false)).toBe('');
  });
  it('the owner switch is off since PR-13 (legal.spec proves the pages show no notice)', () => {
    expect(LEGAL_DRAFT).toBe(false);
  });
});
