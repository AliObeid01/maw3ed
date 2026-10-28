import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderOpenApi } from './render';

const file = path.resolve(import.meta.dirname, '../../openapi.json');
writeFileSync(file, renderOpenApi());
console.log(`wrote ${path.relative(process.cwd(), file)}`);
