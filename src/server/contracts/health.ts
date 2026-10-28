import { z } from 'zod';
import { ErrorResponse, registry } from './registry';

export const HealthDto = registry.register(
  'Health',
  z.object({ status: z.literal('ok'), db: z.literal('up') }),
);

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Liveness and database ping',
  tags: ['system'],
  responses: {
    200: {
      description: 'Service and database are up',
      content: { 'application/json': { schema: HealthDto } },
    },
    503: {
      description: 'Database unreachable',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
