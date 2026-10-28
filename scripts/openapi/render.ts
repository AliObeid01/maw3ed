import { buildOpenApiDocument } from '../../src/server/contracts';

/** Deterministic text for openapi.json. */
export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
