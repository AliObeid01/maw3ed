import { AppError } from '@/server/http/errors';
import { healthRepo } from '@/server/repositories/health.repo';

export interface HealthDeps {
  ping: () => Promise<void>;
}

export const healthService = {
  async check(deps: HealthDeps = healthRepo): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await deps.ping();
    } catch {
      throw AppError.unavailable('Database is unreachable.');
    }
    return { status: 'ok', db: 'up' };
  },
};
