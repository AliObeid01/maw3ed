// Import every contract module here so its paths are registered before the document is generated.
import './health';
import './auth';

export { buildOpenApiDocument, registry } from './registry';
