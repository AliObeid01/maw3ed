import { z } from 'zod';
import { request } from './auth';

// Typed client for the owner's "connected apps" (GET /api/oauth/grants, POST /api/oauth/grants/{id}/revoke).
// The shape mirrors GrantListDto in src/server/contracts/oauthGrants.ts (kept local so the browser bundle does not
// pull in the OpenAPI registry). Both routes answer 404 while MCP_OWNER_ENABLED is off.

export const grantSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type ConnectedApp = z.infer<typeof grantSchema>;

const grantListSchema = z.object({ grants: z.array(grantSchema) });

export const listGrants = async (signal?: AbortSignal): Promise<ConnectedApp[]> =>
  (await request('/api/oauth/grants', grantListSchema, { signal })).grants;

/** 204 on success. */
export const revokeGrant = (id: string) =>
  request(`/api/oauth/grants/${encodeURIComponent(id)}/revoke`, z.unknown(), { method: 'POST' });
