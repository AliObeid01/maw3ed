import { z } from 'zod';
import { errorResponses, registry } from './registry';

/**
 * The owner's view of connected apps (Claude). Session routes, OWNER only. The OAuth protocol routes themselves
 * (/api/oauth/register, /token, /revoke, /authorize, the .well-known documents and /api/mcp/owner) speak OAuth and
 * JSON-RPC, not this API's envelope, and are documented in docs/MCP_OWNER.md instead of this file.
 */
export const GrantParams = z.object({ id: z.string().cuid2() }).strict();

export const GrantDto = registry.register(
  'ConnectedApp',
  z.object({
    id: z.string(),
    clientName: z.string(),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
  }),
);
export const GrantListDto = registry.register('ConnectedAppList', z.object({ grants: z.array(GrantDto) }));

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const security = [{ session: [] }];
const e = errorResponses;

registry.registerPath({
  method: 'get',
  path: '/api/oauth/grants',
  summary: 'Apps connected to this business through the owner connector (owner). 404 while MCP_OWNER_ENABLED is off',
  tags: ['assistant'],
  security,
  responses: {
    200: { description: 'Active connections', content: json(GrantListDto) },
    401: e[401],
    403: e[403],
    404: e[404],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/oauth/grants/{id}/revoke',
  summary: 'Disconnect one app: every token of the connection stops working at once (owner). Another business or an unknown id is 404',
  tags: ['assistant'],
  security,
  request: { params: GrantParams },
  responses: {
    204: { description: 'Disconnected' },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});
