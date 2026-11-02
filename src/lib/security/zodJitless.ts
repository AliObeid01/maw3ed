import { z } from 'zod';

/**
 * Browser only (imported first by `src/instrumentation-client.ts`). Zod 4 probes for `new Function('')` the first
 * time it builds an object schema, to decide whether it may compile a fast path. Our Content-Security-Policy
 * forbids `unsafe-eval`, so the probe is blocked: harmless (zod catches it and falls back), but every page load
 * would report a `securitypolicyviolation`. Turning JIT off up front means the probe never runs. The server keeps JIT.
 */
z.config({ jitless: true });
