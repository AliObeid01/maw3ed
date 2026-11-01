/**
 * The browser's whole view of the SDK: explicit named exports only, loaded with a dynamic `import()` from
 * `instrumentation-client.ts` and nowhere else. Importing the package namespace would pull every export
 * (tracing, replay, feedback, wrappers) into the chunk; naming what we use lets the bundler drop the rest.
 */
export {
  init,
  captureException,
  captureMessage,
  withScope,
  globalHandlersIntegration,
  linkedErrorsIntegration,
  dedupeIntegration,
  breadcrumbsIntegration,
  consoleIntegration,
} from '@sentry/nextjs';
