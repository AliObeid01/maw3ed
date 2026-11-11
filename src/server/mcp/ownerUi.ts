import { cookies } from 'next/headers';
import { isOwnerConnectorEnabled, ownerResource } from './ownerConfig';

/**
 * What the owner dashboard and the /for-business page need to show the owner connector, or null when it is OFF
 * (then nothing about it renders). The link comes from the canonical APP_URL (`ownerResource`), never the request
 * Host. TEST-ONLY addition, like the fake session in app/loadSession.ts: under E2E_FAKE_SESSION=1 (refused in
 * production) the cookie `e2e_mcp_owner=off` makes ONE dev server answer as a server without the flag. It can only
 * turn the feature off.
 */
export type OwnerConnectorInfo = { url: string };

export async function ownerConnectorInfo(): Promise<OwnerConnectorInfo | null> {
  if (!isOwnerConnectorEnabled()) return null;
  if (process.env.E2E_FAKE_SESSION === '1' && (await cookies()).get('e2e_mcp_owner')?.value === 'off') return null;
  return { url: ownerResource() };
}
