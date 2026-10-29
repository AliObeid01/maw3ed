export function shouldMigrate(env: Record<string, string | undefined>): boolean;
export function checkProductionEnv(env: Record<string, string | undefined>): { errors: string[]; warnings: string[] };
