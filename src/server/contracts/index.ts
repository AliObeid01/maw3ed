// Import every contract module here so its paths are registered before the document is generated.
import './health';
import './auth';
import './setup';
import './booking';
import './reminders';
import './outcomes';

export { buildOpenApiDocument, registry } from './registry';
