import { AppError, safeError } from '@/server/http/errors';
import { rootLogger } from '@/server/http/logger';
import { healthRepo } from '@/server/repositories/health.repo';

export interface HealthDeps {
  ping: () => Promise<void>;
}

export const healthService = {
  async check(deps: HealthDeps = healthRepo): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await deps.ping();
    } catch (error) {
      rootLogger.error({ err: safeError(error) }, 'health: database ping failed');
      throw AppError.unavailable('Database is unreachable.');
    }
    return { status: 'ok', db: 'up' };
  },
};
