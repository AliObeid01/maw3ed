import { describe, expect, it } from 'vitest';
import { findCardLeak } from '../../e2e/helpers/cardDigits';

const OK = '4242 4242 4242 4242';
const DECLINE = '4000 0000 0000 0002';

describe('findCardLeak (the matcher behind the e2e card-digits guard)', () => {
  it('detects the card however it was formatted or split', () => {
    expect(findCardLeak('{"number":"4242424242424242"}', [OK])).not.toBeNull();
    expect(findCardLeak('card=4242 4242 4242 4242', [OK])).not.toBeNull();
    expect(findCardLeak('card=4242-4242-4242-4242', [OK])).not.toBeNull();
    expect(findCardLeak('a=4242\nb=4242\nc=4242 4242', [OK])).not.toBeNull();
    expect(findCardLeak('x=4000 0000 0000 0002', [DECLINE])).not.toBeNull();
    expect(findCardLeak('x=4000000000000002', [DECLINE])).not.toBeNull();
  });

  it('does not flag a millisecond epoch, a uuid-like id, or an all-zero id', () => {
    expect(findCardLeak('time=1794177136273 id=00000000-0000-0000-0000-000000000000', [OK, DECLINE])).toBeNull();
    expect(findCardLeak('0000000000000000', [DECLINE])).toBeNull();
    expect(findCardLeak('9999999999999999 1111111111111111', [OK, DECLINE])).toBeNull();
  });

  it('does not flag short partial digits (a 4-digit group, the CVC, the expiry)', () => {
    expect(findCardLeak('cvc=123 exp=12/29 last4=4242', [OK, DECLINE])).toBeNull();
  });
});
