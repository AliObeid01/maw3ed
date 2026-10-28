---
name: api-endpoint
description: Use when adding or changing any Maw3ed API route handler. Step-by-step recipe for a tenant-safe, Zod-validated, OpenAPI-registered endpoint with the route → service → repository layering, error mapping, and the required 400 and cross-tenant 404 tests.
---

# Adding a Maw3ed endpoint

Every route follows the same six steps. Don't skip the tests: the review checks validation and isolation on every route.

## 1. Contract: `src/server/contracts/<area>.ts`
```ts
export const CreateServiceBody = z.object({
  name: z.string().trim().min(1).max(80),
  durationMin: z.number().int().min(5).max(600),
  bufferMin: z.number().int().min(0).max(120).default(0),
  price: z.number().nonnegative(),
}).strict();                                  // unknown fields → 400
export const ServiceParams = z.object({ id: z.string().cuid2() }).strict();
export const ServiceDto = z.object({ /* response shape */ });
```
Register with the OpenAPI registry (`src/server/contracts/registry.ts`): path, method, security (`session`, `token`,
`cronSecret`, or none), request schemas, and responses (200/201, 400, 401, 403, 404, 409 as relevant). Then run
`pnpm openapi:generate` and commit `openapi.json`.

## 2. Route handler: `src/app/api/<path>/route.ts`
```ts
export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], body: CreateServiceBody },
  async ({ ctx, body }) => created(await servicesService.create(ctx, body)),
);
```
- `withRoute` parses params/query/body/headers with Zod (400 with `fields` on failure), resolves the session into
  `ctx = { userId, businessId, role, requestId, logger }`, and maps `AppError` to the shared error shape.
- Auth modes: `'session'` (dashboard), `'public'` (resolve the business by `slug` inside the service), `'token'`
  (verify the HMAC link/offer token, giving `ctx.token`), `'cron'` (constant-time `CRON_SECRET` header check).
- The handler calls **exactly one** service function. No Prisma, no business logic here.

## 3. Service: `src/server/services/<area>.ts`
- First line: role check if needed (`requireRole(ctx, 'OWNER')`). Staff may book, cancel, mark outcomes, mark WhatsApp sent,
  and read clients/calendar; only owners change setup, settings, staff, billing or the pilot baseline.
- Pass `ctx.businessId` into every repository call. Use `prisma.$transaction` via a repository helper when several writes must commit together.
- Throw `AppError.notFound()`, `.conflict('SLOT_TAKEN', data)`, `.forbidden()`, `.validation(fields)`, `.gone()`.

## 4. Repository: `src/server/repositories/<entity>.repo.ts`
```ts
export const serviceRepo = {
  findById: (businessId: string, id: string) =>
    db.service.findFirst({ where: { id, businessId } }),   // never findUnique({ id }) alone
  ...
};
```
- `businessId` is always the first parameter and always part of the `where`.
- Updates and deletes use `updateMany` / `deleteMany` with `{ id, businessId }` and check `count === 1` → else 404.
- Raw SQL (`$queryRaw`) must also filter by `businessId` unless it is a job query over all tenants (jobs only).

## 5. Error mapping (already in `src/server/http/errors.ts`)
| Cause | Status | code |
|---|---|---|
| Zod failure | 400 | `VALIDATION_FAILED` + `fields` |
| No / invalid session | 401 | `UNAUTHENTICATED` |
| Wrong role | 403 | `FORBIDDEN` |
| Not found **or other tenant** | 404 | `NOT_FOUND` |
| Postgres `23P01` (exclusion) | 409 | `SLOT_TAKEN` + `{ slots }` |
| Postgres `23505` (unique) | 409 | `CONFLICT` (or a specific code) |
| Expired token/offer | 410 | `LINK_EXPIRED` / `OFFER_EXPIRED` |

## 6. Tests
- `tests/integration/<area>.test.ts`: happy path; **bad payload → 400 with fields**; **unknown field → 400**;
  for scoped routes **business B's id with business A's session → 404**; wrong role → 403.
- Service logic gets unit tests with fake repositories/providers where useful.
- The `validation.routes.test.ts` sweep picks the route up automatically from the registry; make sure it passes.

Done when: `pnpm lint && pnpm typecheck && pnpm test:int -- <area>` pass and `pnpm openapi:check` is clean.
