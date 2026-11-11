# Owner setup assistant over MCP, with OAuth sign-in

A business **owner** connects Claude to **their own business** and sets it up by chatting ("Set up my barbershop: three
services, Ali and Karam, open 9 to 9 except Sunday, 15-minute slots, 2 hours minimum notice, free cancellation until
12 hours before"). Everything is **proposed first (preview)** and saved only by a separate **apply** call after the owner
agrees. The connector is a SECOND MCP URL, `/api/mcp/owner`, protected by an **OAuth 2.1** sign-in so it works in claude.ai
and Claude desktop, not only Claude Code. The public client connector (`/api/mcp`, `MCP_ENABLED`) is untouched.

**OFF unless `MCP_OWNER_ENABLED` is exactly `true`.** Off means every new route, page and well-known document answers 404
(tested), and the public connector keeps working.

## What the owner allowed Claude to change (and nothing else)

services (add), staff (add), weekly working hours (replace per person), category, area, address, time slot
(`slotStepMin`), minimum notice (`minNoticeMin`), cancellation cutoff (`cancelCutoffMin`).

It cannot: delete anything, touch logins/roles/invites, change the listing switch, plan, payment or deposit settings, or read
or return clients, appointments, waitlist or pilot data. There is no tool with a `businessId`, slug, client or appointment
argument, and the tool list is asserted in `tests/integration/mcp.owner.tools.test.ts`.

## Files

```
src/app/api/mcp/owner/route.ts                      POST: the MCP endpoint (reuses src/server/mcp/protocol.ts with an `authenticate` hook)
src/app/.well-known/oauth-authorization-server/     RFC 8414 metadata
src/app/.well-known/oauth-protected-resource/       RFC 9728 metadata (root and /api/mcp/owner)
src/app/api/oauth/{register,token,revoke,authorize}/route.ts   OAuth protocol routes (thin; wrapper src/server/http/oauthRoute.ts)
src/app/api/oauth/grants/route.ts, grants/[id]/revoke/route.ts  session routes for the owner's "connected apps" (OpenAPI)
src/app/oauth/authorize/page.tsx                    the consent page (server component, no client JS)
src/server/services/oauth.ts                        registration, authorize check, decision, token endpoint, rotation, bearer auth
src/server/services/ownerSetup.ts                   status / preview / apply (calls the dashboard services only)
src/server/mcp/ownerTools.ts, ownerConfig.ts        the three tools; switch and canonical URLs
src/server/domain/{oauth,consentToken,setupProposal}.ts   pure: PKCE, allowlist, consent token, proposal schema + planner
src/server/repositories/{oauth,mcpPlan,unitOfWork}.repo.ts, db.ts   the only Prisma code (unit of work: runInTransaction)
prisma/migrations/20261111150000_mcp_owner_oauth/   tables OAuthClient, OAuthAuthorizationCode, OAuthGrant, OAuthAccessToken,
                                                    OAuthRefreshToken, McpPlan, McpAuditLog
```

Layering is unchanged: routes are thin, logic is in services, only repositories import Prisma, domain is pure. Every
tenant-scoped repository method takes `businessId` first; the business always comes from the **token grant**.

## Why the OAuth routes are not in `openapi.json`

They speak OAuth and JSON-RPC wire formats (form bodies, `{ error, error_description }`, 302 redirects), not this API's
`{ error: { code, message, fields } }` envelope, like `/api/mcp`. Only the two session routes the UI uses are registered:
`GET /api/oauth/grants` and `POST /api/oauth/grants/{id}/revoke` (400, 401, 403, 404 tested). `pnpm openapi:check` passes.

## The flow

1. In Claude the owner adds the connector URL `https://<site>/api/mcp/owner`. (If Claude's advanced settings ask for a client
   id, use `maw3ed-claude`; no secret.)
2. Claude POSTs to the endpoint without a token and gets **401** with
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp/owner"`.
3. Claude reads that document, then `/.well-known/oauth-authorization-server`, then registers itself at `POST /api/oauth/register`
   (RFC 7591, public client) unless it uses the static client `maw3ed-claude`.
4. Claude opens `/oauth/authorize?...` (PKCE S256 required). Not signed in: redirected to `/login?next=...` and back (same-origin,
   validated by `safeNext`). Signed in but not the OWNER of the session's business: a "only the business owner can connect
   Claude" page, no code. OWNER: the consent page ("Claude wants to set up <Business>", what it can and cannot do, Allow / Cancel,
   English and Arabic).
5. Allow posts to `/api/oauth/authorize` (CSRF checks below) which creates a single-use code (60 s) and redirects to
   `redirect_uri?code=...&state=...`; Cancel redirects with `error=access_denied&state=...`.
6. Claude calls `POST /api/oauth/token` (`authorization_code` + `code_verifier`), receives `mw_at_...` (1 h) and `mw_rt_...`
   (30 days), and calls `/api/mcp/owner` with `Authorization: Bearer ...`. It refreshes with rotation.
7. Every call re-verifies that the grant is live and that its user **still holds an OWNER membership** in that business.

## The three tools

| tool | hint | what it does |
| --- | --- | --- |
| `get_setup_status` | readOnly | business name, category, area, address, slot, notice, cutoff; services; staff with their services and a weekly-hours summary; a "what is missing" checklist. No client or appointment data. |
| `preview_setup_changes` | not read-only (it stores a plan row), not destructive | strict proposal in, human-readable before/after lines + `planId` (15 minutes) out. Existing names (case-insensitive) are skipped and reported, never duplicated or edited. Hours REPLACE the weekly pattern of the named person (weekday 0 = Sunday; a weekday not listed is closed). Blocking problems (unknown service, hours for a stranger, duplicates inside the proposal, plan limit) are errors and store nothing. |
| `apply_setup_changes` | destructive (hours replace the weekly pattern), idempotent | claims the plan and applies EVERYTHING in one database transaction through the dashboard services, all or nothing. A retry returns the original result (`alreadyApplied: true`). |

Caps: 20 services, 10 staff, 10 hours entries, 7 weekdays and 6 intervals a day (`MAX_INTERVALS_*`), names and address cleaned by
`sanitize.ts`, no `@` and no 7+ digit numbers in any text, price with at most 2 decimals. Descriptions tell the model to call apply only
after the owner reviewed the preview and explicitly agreed, not to invent data and to ask when something is missing.

Note: signup gives every business one calendar entry for the owner, and the FREE plan allows ONE bookable person, so adding Ali and
Karam on FREE is refused at preview with the plan message. That is the dashboard's rule, reused on purpose.

## Where owners find it

Only inside the dashboard, only for the OWNER, only while `MCP_OWNER_ENABLED=true` (the page passes the flag down as a prop; off renders nothing and mentions nothing).

- **Setup page** (`/app/setup`): the "Set up with Claude" card at the top: the connector link (`APP_URL` + `/api/mcp/owner`, never the request host) with Copy, three steps, three example prompts (tap to copy), what it can and cannot do, the Free-plan note. With a live connection it shrinks to a "Claude is connected" row.
- **Settings** (`/app/settings`): "Connected apps": each live connection with connected / last-used dates, Revoke (confirmed inside the page), empty state with the link.
- **`/for-business`**: a one-paragraph teaser under the five steps with a sign-up button, no link.
- Never on `/assistant` (that page stays for clients).
- The consent page (`/oauth/authorize`) names the business, Claude, where the code goes (claude.ai, claude.com or a local app) and warns to continue only if the owner just started connecting. `?status=blocked` shows a localized "could not confirm" page.
- Tests: `tests/e2e/dashboard/ownerConnector.spec.ts` (mocked APIs, cookie `e2e_mcp_owner=off` simulates the flag off) and `tests/e2e/ownerConsent.real.spec.ts` (the real consent form in a real browser against a local server and database; run with `OWNER_REAL_URL`, the browser cannot resolve claude.ai so nothing leaves the machine).

## Threat model: each mitigation and the test that proves it

Mutation column: the rule was disabled on purpose, the named test failed, the rule was restored.

| # | Threat | Mitigation | Test (file > test) | Mutation |
| --- | --- | --- | --- | --- |
| 1 | Authorization-code theft or replay | 60 s, 256-bit, only sha256 stored, atomic single-use claim (`UPDATE ... WHERE usedAt IS NULL`), presenting a used code revokes the grant it produced | oauth > "replayed code ... revokes every token", "concurrent exchanges ... exactly one", "expired code" | caught (3 variants) |
| 2 | Code interception without the verifier | PKCE S256 mandatory (no `plain`), constant-time compare; a failed attempt burns the code | oauth > "wrong PKCE verifier ... code is burned"; unit oauthDomain > PKCE | caught |
| 3 | Code redirected to an attacker | exact-match redirect allowlist (only the two Claude callbacks and `http://localhost|127.0.0.1:<port>`), per-client registered list, bad client/redirect shown on our page and never redirected, `redirect_uri` and `client_id` re-checked at the token endpoint | oauth > "register ... rejects every other redirect URI", "authorize ... shows (never redirects)", "wrong redirect_uri or client_id"; unit oauthDomain > allowlist | caught (4 variants) |
| 4 | Non-owner (receptionist, practitioner) connects Claude | role checked on the page AND again on the decision POST from the session | oauth > "a receptionist (STAFF) or a PRACTITIONER can NOT authorize" | caught |
| 5 | CSRF on Allow | SameSite=Lax session cookie + same-origin proof (a real `Origin` equal to `APP_URL`'s decides alone; when the browser sends no Origin or the literal `null` the browser-set `Sec-Fetch-Site: same-origin` is required; anything else gets 303 to `/oauth/authorize?status=blocked`) + `Referrer-Policy: same-origin` on `/oauth/*` (no-referrer would make every form POST carry `Origin: null`) + HMAC consent token bound to user, business, client, redirect, challenge, state (10 min) + one-time nonce | oauth > "CSRF: a missing or foreign Origin...", "tampered, garbage or expired consent token", "consent form is one-time"; unit consentToken | caught (Origin, user binding, one-time) |
| 6 | Stolen refresh token | rotation; a used token shown again revokes the whole grant, except a retry within 20 s of the rotation by the same client_id (a lost response), which is `invalid_grant` without revoking; partial unique index = one unused refresh token per grant; concurrent reuse | oauth > "rotates", "REUSE ... revokes the whole grant", "concurrent refreshes" | caught (2 variants) |
| 7 | Tokens at rest | only sha256 stored; tests dump every OAuth table and look for the raw values | oauth > "exchanges a code ... only hashes stored" | n/a (structure) |
| 8 | Tokens in logs/Sentry | scrubber rules for `mw_at_`/`mw_rt_`, verifier, challenge, consent, redirect_uri, access/refresh_token keys; handlers never log request values | unit scrubOauth | caught |
| 9 | Owner demoted or removed but a token still works | owner membership re-verified on EVERY call, grant revoked on mismatch (not resurrected by re-promotion); also at code exchange and refresh | oauth > "owner who lost the OWNER role is 401...", "removed membership", "demoted before the exchange", "demoted owner cannot refresh" | caught |
| 10 | Revoked or expired token accepted | grant `revokedAt`, token expiry, token rows deleted on revoke | oauth > "revoked grant is 401", "flagged revoked ... defence in depth", "expired access token" | caught |
| 11 | Cross-tenant access | business from the grant only; no tool takes a business or id; plans bound to (business, grant); grant revoke scoped by business | oauth > "cross-tenant: business A cannot revoke B's grant"; tools > "token of business A can never read or modify business B", "another business's plan id is not found", "refuses a businessId ... argument" | caught |
| 12 | Plan replay / double apply / tamper | claim `UPDATE ... WHERE appliedAt IS NULL AND expiresAt > now RETURNING` inside the apply transaction; stored result returned on retry; hash of the validated proposal re-checked | tools > "apply twice ... (also 3 at once)", "expired plan", "tampered", "same business other connection" | caught (5 variants) |
| 13 | Partial apply | `runInTransaction` unit of work: the dashboard services run on one transaction client, a failure rolls back everything including the claim | tools > "is all or nothing" | caught |
| 14 | Prompt injection via names | `cleanText` on input AND on every output string, quoted in prose, static tool descriptions | tools > "cleans prompt-injection text" (input and output); unit setupProposal | caught (output has two layers, `getStatus` and `cleanDeep`: removing ONE is not detectable by design, removing both is caught) |
| 15 | Scope creep / privacy | strict schemas, closed field list, tool list asserted, no client/appointment data in any output, audit rows hold counts only | tools > "can neither name another business nor reach clients...", "no client or appointment data, ever", "audit row" | caught (audit) |
| 16 | Abuse | per-grant limits (calls 300/10 min, previews 30/h, applies 10/h), per-IP limits on every protocol route (generous: Claude's servers share addresses), invalid-token budget per IP, body caps, Origin rule | tools > "per-grant limits" | caught (preview limit) |
| 17 | Host-header issuer spoofing | issuer and endpoints built from `APP_URL` only | oauth > "serves the authorization server metadata from APP_URL" (a hostile Host header changes nothing; the code never reads Host) | value mutated: caught |
| 18 | Kill switch | exact `true` only; every route 404 when off; public connector unaffected | oauth > "MCP_OWNER_ENABLED off ..." (3 tests) | caught (always-on and truthy-string variants) |

Not covered by an automated test: the consent page component itself (server component: login redirect, not-owner page, the form markup).
The decision endpoint enforces the same rules and is tested; the page was type-checked, linted and the i18n keys checked.

## Secrets and environment

- **New env var: `MCP_OWNER_ENABLED`** (`true` to turn the feature on). Nothing else is new.
- The consent HMAC key is derived with HKDF from the existing `LINK_SECRET` (label `maw3ed.oauth.consent.v1`); rotating `LINK_SECRET`
  invalidates open consent forms only (tokens are random and stored hashed, they do not depend on it).
- Issuer and URLs come from `APP_URL` (https in production). It must be the public origin people paste into Claude.

## How to switch it on and add it in Claude (owner)

1. Merge and let Vercel deploy (the migration `20261111150000_mcp_owner_oauth` is applied by the build; the feature is OFF).
2. In Vercel set `MCP_OWNER_ENABLED=true` (Production) and redeploy.
3. Check `https://<site>/.well-known/oauth-authorization-server` returns JSON (404 means still off).
4. In Claude: Customize > Connectors > Add custom connector, paste `https://<site>/api/mcp/owner`, then Connect. Sign in to Maw3ed as the
   OWNER when asked and press Allow.
5. Ask: "Set up my barbershop: ...". Review the preview, say yes, Claude applies it.
6. To disconnect: Settings > Connected apps (UI by the frontend task) or `POST /api/oauth/grants/{id}/revoke`.
7. Emergency stop: unset `MCP_OWNER_ENABLED` and redeploy; every route is 404 at once. Existing tokens are inert while off.

## Deviations from the written design (and why)

- The static client `maw3ed-claude` lives in code, not in the `OAuthClient` table (nothing to seed or migrate); it accepts any redirect
  URI the allowlist accepts. Dynamic clients must register their exact URIs.
- Invalid or expired consent forms redirect to `/oauth/authorize?status=expired` (a localized page) instead of returning JSON,
  because the caller is a browser form post.
- Revoking via RFC 7009 revokes the whole grant (access or refresh token alike): the owner's intent is "disconnect".
- Per-IP budgets on the protocol routes are generous and per-grant budgets are the tight ones: Claude connects from Anthropic's shared
  addresses (same reasoning as the public connector).
- The one-time consent token is enforced by a unique `consentNonce` on the issued code row, not a separate table.
- Cleanup purges expired codes, tokens, plans, long-revoked grants and unused dynamic clients; its count is logged as `mcpOwner` (it is not in
  `CleanupResult`, whose shape other tests assert). Audit rows are kept.
- Raw names are length-checked BEFORE cleaning (80 characters), so a name that is only long because of hidden characters is refused.
- `proposal` hours for a person who is switched off are refused; services of an inactive service are still assignable.
- The consent page needs `form-action` to allow the OAuth client's redirect: `src/proxy.ts` adds `https://claude.ai`, `https://claude.com` and
  loopback to `form-action` for `/oauth/authorize` ONLY (Chrome applies `form-action` to the redirect after a form POST).
- `scripts/demo` removal needs no change: the new tables cascade from `Business` and `User`.
- `preview_setup_changes` is `readOnlyHint: false` (review: it stores a plan row) and `apply_setup_changes` is `destructiveHint: true` (hours replace a weekly pattern).
- Loopback redirect URIs: `localhost` is case-insensitive; `http://[::1]:<port>` is NOT accepted (CSP `form-action` has no IPv6 literal host-source, so Chrome would block the Allow redirect). Matching stays exact-string.
- Well-known documents are cached 60 s.

## Honest unknowns

- Not run against the real Claude client: its exact discovery order (root vs path-suffixed well-known), whether it sends `resource`, and whether
  it uses the static client id are as documented by the MCP authorization spec but unconfirmed here.
- `APP_URL` must equal the host the owner pasted; a `resource` that does not match is rejected (`invalid_target`).
- The consent page is now exercised in a real browser by `tests/e2e/ownerConsent.real.spec.ts` (Allow and Cancel).
