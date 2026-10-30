// Import every contract module here so its paths are registered before the document is generated.
import './health';
import './auth';
import './setup';
import './booking';
import './reminders';
import './outcomes';
import './waitlist';
import './directory';
import './billing';
import './deposit';

export { buildOpenApiDocument, registry } from './registry';
