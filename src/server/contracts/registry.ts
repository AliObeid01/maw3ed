import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'session', {
  type: 'apiKey',
  in: 'cookie',
  name: 'maw3ed_session',
});
registry.registerComponent('securitySchemes', 'cronSecret', {
  type: 'apiKey',
  in: 'header',
  name: 'x-cron-secret',
});

/** Shared error envelope: `{ error: { code, message, fields } }`. */
export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_FAILED' }),
      message: z.string(),
      fields: z.record(z.string(), z.string()),
      data: z.unknown().optional(),
    }),
  }),
);

export const errorResponses = {
  400: {
    description: 'Validation failed',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  401: {
    description: 'Not authenticated',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  403: { description: 'Wrong role', content: { 'application/json': { schema: ErrorResponse } } },
  404: {
    description: 'Not found (or belongs to another business)',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  409: {
    description: 'Conflict (SLOT_TAKEN, CONFLICT)',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  410: {
    description: 'Link or offer expired',
    content: { 'application/json': { schema: ErrorResponse } },
  },
} as const;

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Maw3ed API',
      version: '0.1.0',
      description: 'Booking and no-show reduction API.',
    },
    servers: [{ url: '/' }],
  });
}
