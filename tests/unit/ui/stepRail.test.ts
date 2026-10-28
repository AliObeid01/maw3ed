import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StepRail } from '@/components/public/StepRail';
import { render } from './helpers';

const steps = [
  { id: 'service', label: 'Service', value: 'Haircut' },
  { id: 'staff', label: 'Staff', value: 'Lina' },
  { id: 'time', label: 'Day and time' },
  { id: 'details', label: 'Your details' },
];

const html = (current: number) => render(createElement(StepRail, { steps, current }));

describe('StepRail', () => {
  it('marks exactly one list item as the current step', () => {
    const out = html(3);
    const items = out.match(/<li[^>]*aria-current="step"[^>]*>/g) ?? [];
    expect(items).toHaveLength(1);
    const li = out.match(/<li[^>]*aria-current="step"[^>]*>[\s\S]*?<\/li>/)![0];
    expect(li).toContain('Day and time');
    expect(out.match(/<li/g)).toHaveLength(4);
  });

  it('shows the chosen value only for completed steps', () => {
    const out = html(3);
    expect(out).toContain('Haircut');
    expect(out).toContain('Lina');
    expect(html(1)).not.toContain('Haircut');
  });

  it('gives the progressbar an accessible name and the current value', () => {
    const out = html(2);
    const bar = out.match(/<div[^>]*role="progressbar"[^>]*>/)![0];
    expect(bar).toContain('aria-label="Booking progress"');
    expect(bar).toContain('aria-valuenow="2"');
    expect(bar).toContain('aria-valuemax="4"');
    expect(bar).toContain('aria-valuetext="Step 2 of 4"');
  });
});
