import { describe, expect, it } from 'vitest';
import { clampStep, initialRevealState, nextRevealState, MAX_STEP } from '@/lib/motion/reveal';

const base = { reducedMotion: false, hasObserver: true, top: 1200, viewportHeight: 800 };

describe('initialRevealState (decided after mount, so the server HTML is always visible)', () => {
  it('hides only a block that starts below the fold, with motion allowed and an observer available', () => {
    expect(initialRevealState(base)).toBe('hidden');
  });
  it('never hides under prefers-reduced-motion: reduce', () => {
    expect(initialRevealState({ ...base, reducedMotion: true })).toBe('visible');
  });
  it('never hides without IntersectionObserver (nothing could ever reveal it)', () => {
    expect(initialRevealState({ ...base, hasObserver: false })).toBe('visible');
  });
  it('keeps what is already on screen, or above it, visible at once (no flash of hidden content)', () => {
    expect(initialRevealState({ ...base, top: 0 })).toBe('visible');
    expect(initialRevealState({ ...base, top: 799 })).toBe('visible');
    expect(initialRevealState({ ...base, top: -400 })).toBe('visible');
  });
  it('treats the exact fold as below it', () => {
    expect(initialRevealState({ ...base, top: 800 })).toBe('hidden');
  });
});

describe('nextRevealState', () => {
  it('a hidden block is revealed once it intersects, and again events change nothing', () => {
    expect(nextRevealState('hidden', 'intersect')).toBe('revealed');
    expect(nextRevealState('revealed', 'intersect')).toBe('revealed');
  });
  it('turning reduced motion on while hidden reveals at once', () => {
    expect(nextRevealState('hidden', 'reduced')).toBe('revealed');
  });
  it('a visible block stays as it is', () => {
    expect(nextRevealState('visible', 'intersect')).toBe('visible');
    expect(nextRevealState('visible', 'reduced')).toBe('visible');
  });
});

describe('clampStep (stagger index, at most 6 so a group never takes long)', () => {
  it('clamps to 0..MAX_STEP and rounds', () => {
    expect(MAX_STEP).toBe(6);
    expect(clampStep(undefined)).toBe(0);
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(2.6)).toBe(3);
    expect(clampStep(99)).toBe(6);
    expect(clampStep(Number.NaN)).toBe(0);
  });
});
