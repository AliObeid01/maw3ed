import { describe, expect, it } from 'vitest';
import { StepState, stepState } from '@/components/public/stepState';

describe('stepState', () => {
  it('marks earlier steps done, the current one current and later ones todo', () => {
    expect([1, 2, 3, 4].map((n) => stepState(n, 3))).toEqual([
      StepState.Done,
      StepState.Done,
      StepState.Current,
      StepState.Todo,
    ]);
  });

  it('has no done steps on the first step', () => {
    expect(stepState(1, 1)).toBe(StepState.Current);
    expect(stepState(2, 1)).toBe(StepState.Todo);
  });
});
