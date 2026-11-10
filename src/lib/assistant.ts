/**
 * The assistant (MCP connector) kill switch. ONLY the exact value `true` of `MCP_ENABLED` enables it; unset or
 * anything else (including "TRUE", "1", " true") is OFF. It is read at request time, never at import, so
 * the endpoint, the /assistant page and the footer link all follow the same switch. Never default on.
 * Flip the variable in Vercel, then redeploy.
 */
export function isAssistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLED === 'true';
}

/** The connector URL people paste into Claude: the site's public origin plus `/api/mcp`. Never a hardcoded domain. */
export function connectorUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL || env.APP_URL || 'http://localhost:3000').trim();
  return `${base.replace(/\/+$/, '')}/api/mcp`;
}

/** The three example prompts, in display order (message keys under `assistant.prompts`). */
export const PROMPT_KEYS = ['book', 'find', 'waitlist'] as const;

/**
 * The five things the /assistant "What Claude can do" panel claims, each mapped to the MCP tools that really do it
 * (src/server/mcp/tools.ts). A unit test keeps this list equal to the nine tools: add a claim only with a tool.
 * Message keys: `assistant.can.items.<id>`.
 */
export const CAPABILITIES = [
  { id: 'find', tools: ['search_businesses', 'get_business', 'get_free_times'] },
  { id: 'book', tools: ['prepare_booking', 'create_booking'] },
  { id: 'waitlist', tools: ['join_waitlist'] },
  { id: 'check', tools: ['get_booking'] },
  { id: 'manage', tools: ['confirm_booking', 'cancel_booking'] },
] as const;
