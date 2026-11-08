import { describe, expect, it } from 'vitest';
import {
  PRO_INTENT_KEY,
  clearProIntent,
  proIntentFor,
  setProIntent,
  type IntentStorage,
} from '@/lib/billing/proIntent';

class Mem implements IntentStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const boom: IntentStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

describe('pro intent (a device-side reminder that Pro was chosen at signup)', () => {
  it('is remembered for the business it was set for, and only that one', () => {
    const s = new Mem();
    setProIntent('studio-nour', s);
    expect(proIntentFor('studio-nour', s)).toBe(true);
    expect(proIntentFor('other-biz', s)).toBe(false);
  });

  it('clearProIntent forgets it', () => {
    const s = new Mem();
    setProIntent('studio-nour', s);
    clearProIntent(s);
    expect(proIntentFor('studio-nour', s)).toBe(false);
    expect(s.getItem(PRO_INTENT_KEY)).toBeNull();
  });

  it('ignores corrupt or hostile storage and never throws', () => {
    for (const raw of ['', '{', 'null', '[]', '{"v":2,"slug":"studio-nour"}', '{"v":1,"slug":42}', '{"v":1,"slug":"../x"}']) {
      const s = new Mem();
      s.setItem(PRO_INTENT_KEY, raw);
      expect(proIntentFor('studio-nour', s), raw).toBe(false);
    }
    expect(() => setProIntent('studio-nour', boom)).not.toThrow();
    expect(proIntentFor('studio-nour', boom)).toBe(false);
    expect(() => clearProIntent(boom)).not.toThrow();
    expect(proIntentFor('studio-nour', undefined)).toBe(false);
  });

  it('refuses to store a slug that is not a valid slug', () => {
    const s = new Mem();
    setProIntent('<script>', s);
    expect(s.getItem(PRO_INTENT_KEY)).toBeNull();
  });
});
