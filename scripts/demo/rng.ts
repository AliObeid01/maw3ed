/**
 * Seeded randomness for the demo tooling. Everything the generators draw comes from here, never from Math.random()
 * or the clock, so the same seed and the same `now` always give the same data.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** Index drawn with the given non-negative weights. */
  weighted(weights: readonly number[]): number;
}

/** mulberry32: small, fast, good enough for fixtures (not for secrets). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    weighted: (weights) => {
      const total = weights.reduce((s, w) => s + w, 0);
      if (total <= 0) return 0;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] as number;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
  };
}

/** A 32-bit seed from a base number and a label (FNV-1a), so each business gets its own stable stream. */
export function seedFrom(base: number, label: string): number {
  let h = 2166136261 ^ base;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** cuid-shaped ids ('c' + 24 lowercase alphanumerics) drawn from the seeded stream, so a plan is fully repeatable. */
export function makeIdFactory(rng: Rng): () => string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const used = new Set<string>();
  return () => {
    for (;;) {
      let id = 'c';
      for (let i = 0; i < 24; i++) id += alphabet[Math.floor(rng.next() * alphabet.length)];
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}
