import { getServerEnv } from '@/server/env';

/**
 * Switch and canonical URLs of the OWNER connector (docs/MCP_OWNER.md). Separate from `MCP_ENABLED` (the public
 * client connector): only the exact value `true` of `MCP_OWNER_ENABLED` turns the new routes, pages and well-known
 * documents on. Read per request, never at import. Anything else answers 404 like a missing route.
 */
export function isOwnerConnectorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_OWNER_ENABLED === 'true';
}

/**
 * The ONE canonical site origin (APP_URL, validated by getServerEnv: https in production). Issuer, endpoints and
 * the resource are built from it, never from the request Host or X-Forwarded-* headers (host-header injection).
 */
export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return getServerEnv(env).APP_URL.replace(/\/+$/, '');
}

export const OWNER_MCP_PATH = '/api/mcp/owner';

export const ownerResource = (env?: NodeJS.ProcessEnv) => `${siteOrigin(env)}${OWNER_MCP_PATH}`;
export const protectedResourceMetadataUrl = (env?: NodeJS.ProcessEnv) =>
  `${siteOrigin(env)}/.well-known/oauth-protected-resource${OWNER_MCP_PATH}`;

export function protectedResourceMetadata(env?: NodeJS.ProcessEnv) {
  return {
    resource: ownerResource(env),
    authorization_servers: [siteOrigin(env)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['setup'],
  };
}

export function authorizationServerMetadata(env?: NodeJS.ProcessEnv) {
  const origin = siteOrigin(env);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['setup'],
  };
}

/** A resource indicator (RFC 8707) is accepted only when it names exactly our owner endpoint. */
export function resourceMatches(value: string, env?: NodeJS.ProcessEnv): boolean {
  return value.replace(/\/+$/, '') === ownerResource(env);
}
