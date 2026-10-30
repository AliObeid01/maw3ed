/* eslint-disable react/no-children-prop -- createElement typings need children in props here */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Bidi, isolate, ltr, MetaLine, TimeRange, timeRangeText } from '@/components/ui/Bidi';
import { render } from './helpers';

describe('bidi helpers', () => {
  it('keeps a time range as one left-to-right unit in start-to-end order', () => {
    const text = timeRangeText('9:00', '9:30');
    expect(text).toBe('⁦9:00 – 9:30⁩');
    expect(ltr('$15')).toBe('⁦$15⁩');
    expect(isolate('Karim')).toBe('⁨Karim⁩');
  });

  it('renders TimeRange as an ltr bdi', () => {
    const out = render(createElement(TimeRange, { start: '9:00', end: '9:30' }));
    expect(out).toContain('<bdi dir="ltr"');
    expect(out).toContain('9:00 – 9:30');
    expect(render(createElement(TimeRange, { start: '9:00' }))).not.toContain('–');
  });

  it('builds a meta line from separate items with a separator only between them', () => {
    const out = render(
      createElement(MetaLine, {
        items: [
          createElement(Bidi, { key: 'a', children: 'Haircut' }),
          null,
          false,
          createElement(Bidi, { key: 'b', children: 'Lina' }),
        ],
      }),
    );
    expect(out.match(/·/g)).toHaveLength(1);
    expect(out).toMatch(/<bdi[^>]*>Haircut<\/bdi><span[^>]*> · <\/span><bdi[^>]*>Lina<\/bdi>/);
  });

  it('draws no separator for a single item', () => {
    const out = render(createElement(MetaLine, { items: [createElement(Bidi, { key: 'a', children: 'Only' })] }));
    expect(out).not.toContain('·');
  });
});
