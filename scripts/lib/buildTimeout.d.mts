export const DEFAULT_BUILD_TIMEOUT_MINUTES: number;
export const MIN_BUILD_TIMEOUT_MINUTES: number;
export const MAX_BUILD_TIMEOUT_MINUTES: number;
export function buildTimeoutMinutes(env: Record<string, string | undefined>): number;
export function buildTimeoutMessage(minutes: number): string;
