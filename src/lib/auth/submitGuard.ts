/** Blocks a second submit while one is in flight (the button's `loading` state alone is not enough for Enter-key repeats). */
export function createSubmitGuard() {
  let busy = false;
  return {
    isBusy: () => busy,
    /** Returns false when a submit is already running. */
    tryStart(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    /** Call after a failure so the user can try again. Not after success: stay busy until navigation. */
    release() {
      busy = false;
    },
  };
}
