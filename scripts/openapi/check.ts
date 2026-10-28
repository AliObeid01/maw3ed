import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderOpenApi } from './render';

const file = path.resolve(import.meta.dirname, '../../openapi.json');
const fresh = renderOpenApi();
const committed = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';

if (fresh !== committed) {
  console.error('openapi.json is stale. Run `pnpm openapi:generate` and commit the result.');
  process.exit(1);
}
console.log('openapi.json is up to date');
