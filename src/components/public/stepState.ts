export enum StepState {
  Done,
  Current,
  Todo,
}

/** State of 1-based step `n` when the user is on step `current`. */
export function stepState(n: number, current: number): StepState {
  if (n < current) return StepState.Done;
  if (n === current) return StepState.Current;
  return StepState.Todo;
}
