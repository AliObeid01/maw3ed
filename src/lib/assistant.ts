/**
 * The assistant (MCP connector) kill switch. ONLY the exact value `true` of `MCP_ENABLED` enables it; unset or
 * anything else (including "TRUE", "1", " true") is OFF. It is read at request time, never at import, so
 * the endpoint, the /assistant page and the footer link all follow the same switch. Never default on.
 * Flip the variable in Vercel, then redeploy.
 */
export function isAssistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLED === 'true';
}
