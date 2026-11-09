# Maw3ed assistant connector (MCP) — PR-15a

A client can find and book appointments by chatting with Claude. Maw3ed exposes one Model Context Protocol (MCP)
endpoint, `POST /api/mcp`, that Claude adds as a **custom connector** (Customize > Connectors > Add custom connector,
paste the link). The public page `/assistant` explains the three steps. Works with Claude only. Not in the Claude
directory. **OFF unless `MCP_ENABLED` is exactly `true`.**

## Architecture

```
route   src/app/api/mcp/route.ts        kill switch, then hands the Request to the protocol layer. Not an OpenAPI route.
protocol src/server/mcp/protocol.ts     JSON-RPC parsing/validation only: method, Origin, content type, size, versions, headers
tools   src/server/mcp/tools.ts         the nine tools: strict Zod inputs, annotations, result/error shaping, global limits, logging
sanitize src/server/mcp/sanitize.ts     strips invisibles/bidi/markup from business-entered text, caps length
service src/server/services/assistant.ts  the use cases; calls EXISTING services only (never Prisma, never the HTTP API)
```

The service reuses: `directoryService.list` (search), `availabilityService.slots` (free times), `publicBookingService.book`
→ `book()` (THE booking insert: exclusion constraint, client upsert by E.164 phone, reminder jobs, booking email,
deposit hold), `joinWaitlist`, `linksService.get/act` (view/confirm/cancel with the unchanged late-cancel rule) and
`resolveToken`. The only repository additions are `publicBusinessRepo.findListedBySlug / findListedById`. No migration.
The three guarantees (no double booking, no duplicate reminder, DST-correct slots) are untouched.

## Spike decision: hand-rolled, no dependency

Checked on 9 Nov 2026: `@modelcontextprotocol/sdk` 1.32.2 (latest v1; protocol 2025-11-25, express/hono dependencies,
no 2026-07-28) and `@modelcontextprotocol/server` 2.4.0 (v2; 2026-07-28 with `createMcpHandler`, a Web `Request`/`Response`
handler with a stateless legacy fallback, no session by default). v2 would probably work, but it is a brand-new major,
decides status codes and error codes internally, and the kill switch, Origin rule, size cap, rate limits and sanitizing
all wrap around it anyway. The surface we need is five methods, so the endpoint is a small hand-rolled handler
(`protocol.ts`, ~250 lines): no dependency, exact control of the spec facts, easy to test. Revisit v2 later if the
protocol grows (resources, prompts, subscriptions). Verified with the MCP Inspector CLI (which uses the official SDK
client) and with a hand-written JSON-RPC client in the integration tests.

## Protocol versions: both, from one URL

Claude's client still documents the **legacy** `initialize` handshake (specs 2025-03-26 / 06-18 / 11-25). The current spec
**2026-07-28** is stateless. We serve both, statelessly, always with a single `application/json` answer (no SSE) and
never a `Mcp-Session-Id`.

| Request | Flow |
| --- | --- |
| `MCP-Protocol-Version` is 2026-07-28 | 2026 rules: headers `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for `tools/call`) must equal the body (`_meta["io.modelcontextprotocol/protocolVersion"]`, `method`, `params.name`); else 400 + `-32020`. Results carry `resultType: "complete"`; `tools/list` and `server/discover` carry `ttlMs` and `cacheScope: "public"`. |
| header is a legacy version, or absent with no 2026 `_meta` | legacy: `initialize` (negotiates 2025-xx), `notifications/initialized` → 202, `ping`, `tools/list`, `tools/call`. (Legacy clients send `MCP-Protocol-Version: 2025-xx` after initialize; that is still the legacy flow.) |
| header unsupported | 400 + `-32022` with the supported versions in `data.supported` |
| 2026 `_meta` but no header | 400 + `-32020` |

Other rules: POST only (GET, DELETE and the rest answer 405 `Allow: POST`; OPTIONS is a plain 204 with `Allow: POST` and no CORS headers); `Content-Type: application/json` (415); body at
most 64 KB (413); invalid JSON → 400 `-32700`; batch arrays → 400 `-32600`; unknown method → 404 `-32601`; notifications → 202
with no body; unknown tool and missing tool name → JSON-RPC `-32602` (HTTP 200); tool errors are normal results with
`isError: true` and actionable text; every response is `Cache-Control: no-store`.

**Origin**: absent is allowed (Anthropic connects server-side without one). If present it must be `https://claude.ai`,
`https://claude.com`, the origin of `APP_URL`, an entry of `MCP_ALLOWED_ORIGINS` (comma-separated), or (not in production)
`http://localhost:*`; otherwise 403. A browser-based caller that is not on the list cannot ride the endpoint; an overly strict
rule or a firewall could block Anthropic, so the rule only restricts requests that claim a browser origin.

## The nine tools (fixed order)

| # | name | title | hint | inputs | returns |
| --- | --- | --- | --- | --- | --- |
| 1 | `search_businesses` | Search businesses | read | `query?`, `category?`, `area?`, `limit<=10` | slug, name, category, area, address, serviceCount, fromPrice, nextFree (local label) |
| 2 | `get_business` | Get business details | read | `slug` | services (id, name, durationMin, price, currency), bookable staff, timezone, booking page URL |
| 3 | `get_free_times` | Get free times | read | `slug`, `serviceId`, `staffId?`, `fromDate?`, `days<=7` | up to 60 times: ISO start with offset, local label, staffId; says times can be taken |
| 4 | `prepare_booking` | Prepare a booking | read (writes nothing) | `slug`, `serviceId`, `staffId?`, `startAt` | summary + `confirmationToken` (10 minutes) |
| 5 | `create_booking` | Create a booking | destructive | `confirmationToken`, `name`, `phone`, `email` | reference, status, local time, manage link; deposit: `payUrl` + `holdMinutes`; SLOT_TAKEN: fresh times |
| 6 | `join_waitlist` | Join a waitlist | destructive | `slug`, `serviceId`, `staffId?`, `dateFrom`, `dateTo`, `name`, `phone`, `email` | joined / already on it |
| 7 | `get_booking` | Get a booking | read | `token` (manage link URL or token) | status, local time, service, staff, reference |
| 8 | `confirm_booking` | Confirm a booking | destructive | `token` | result (idempotent) |
| 9 | `cancel_booking` | Cancel a booking | destructive | `token` | result: `cancelled`, `late_cancelled` (existing rule), `already_cancelled` |

Every tool has `title`, a static factual description, `inputSchema` (JSON Schema 2020-12, `additionalProperties: false`;
unknown arguments are rejected with an actionable result) and the four annotations. Reads are `readOnlyHint: true`;
writes are `destructiveHint: true`, so Claude always asks the person first. Names are at most 64 characters. Only
**listed** businesses (`Business.listed = true`) are visible to the slug tools; an unknown or unlisted slug is "not found".
Ids of another business are "not found" as everywhere else.

### The signed confirmation token

The token is NOT single-use: it may be reused for 10 minutes. Same-phone replays are safe (the idempotency key `sha256(token + phone)` returns the same booking) and for different phones the exclusion constraint decides who gets the slot. The prepare key derives from `LINK_SECRET`, so rotating that secret invalidates both link and prepare tokens.

`prepare_booking` checks the slot is offered right now (no write, no client data) and returns a token signed with an HMAC
under a key derived from `LINK_SECRET` for this purpose (`maw3ed.mcp.prepare.v1`), payload `{ act:'prepare', b: businessId,
s: serviceId, p: staffId|null, t: startAt, exp }`, valid 10 minutes, no database row (`src/server/domain/prepareToken.ts`).
It is a separate module rather than a new act in `tokens.ts` on purpose: different key and a different payload shape mean a
link token (view/confirm/cancel/pay/claim/leave) can never verify as a prepare token and the reverse (both tested). The
description states the lifetime. `create_booking` verifies signature, expiry and that the business is still listed, then
uses the booking service with the idempotency key `sha256(token + "|" + E.164 phone)`: repeating the call returns the same
booking. Deposits: the booking service decides; the tool returns the `/pay/<token>` page URL, and the client pays on the web.
No card data is ever taken in the tool.

## Safety

- **Kill switch**: `MCP_ENABLED`, read per request. Only the exact string `true` enables it. Unset/anything else: the endpoint
  answers 404 (like a missing route), `/assistant` is a 404 and the footer link is hidden.
- **Rate limits** (Postgres limiter, no migration; every number lives in `RATE_POLICIES` in
  `src/server/services/rateLimitPolicies.ts`, with the arithmetic in a comment). Never per IP: every Claude user arrives
  from Anthropic's few addresses (the directory's per-IP "live" budget is bypassed for the same reason).

  | Policy | Applies to | Limit |
  | --- | --- | --- |
  | `mcpRead` | valid read calls, whole connector | 600 per 10 min |
  | `mcpReadBusiness` | business-scoped reads, per business | 300 per 10 min |
  | `mcpInvalid` | malformed or invalid calls (bad arguments, bad or expired tokens, not found) | 300 per 10 min |
  | `mcpBookHour` / `mcpBookDay` | `create_booking`, all callers | 10 per hour, 20 per day |
  | `mcpBookBusinessDay` | `create_booking`, per business | 8 per day |
  | `mcpPhone` / `mcpPhoneDay` | `create_booking` and `join_waitlist`, per HMAC of the phone | 5 per hour, 3 per day |
  | `mcpEmail` | `create_booking`, per HMAC of the normalized mailbox (lowercased, `+tag` removed; gmail/googlemail also without dots) | 2 per day |
  | `mcpEmailWait` | `join_waitlist`, per HMAC of the lowercased email | 3 per day |
  | `mcpWaitHour` / `mcpWaitDay` | `join_waitlist`, all callers | 20 per hour, 40 per day |
  | `mcpLinkToken` | `get_booking`, `confirm_booking`, `cancel_booking`, per HMAC of the link token | 20 per hour |

  **Order.** Arguments (Zod) and tokens (signature, expiry, act; no database) are checked BEFORE any write bucket is
  spent. An invalid call costs only `mcpInvalid`, so garbage can never use up the write budgets (a test sends 130 garbage
  calls and then books). Reads and writes have separate buckets, so neither starves the other. A write then checks the
  email budget guard, then spends its buckets (email, phone, business, global); if any bucket is full everything spent
  before it is given back, and a booking that then fails (slot taken, validation, deposit) or is an idempotent replay gives
  every hit back, so only a real booking is counted. A refused attempt leaves the counts unchanged.

  **Email arithmetic.** Resend's free tier is about 100 emails a day for ALL tenants; `reminders.ts` warns at
  `EMAIL_BUDGET_WARN` 80 and skips booking confirmations at 95. One chat booking queues up to 3 emails (confirmation, H24,
  H2), so 20 bookings a day is at most 60 emails even if every reminder lands on the same day, leaving 40 for real
  traffic. Waitlist joins send nothing at join time (only a claim-offer email later), 40 a day is the cap. **Existing
  limitation, not changed here: the H24 and H2 reminders have no budget check today; only booking confirmations are
  skipped at 95.**

  **Email-budget guard.** `create_booking` and `join_waitlist` read today's sent-email count the way `reminders.ts`
  does (sent reminder emails plus waitlist offers since 00:00 UTC) and refuse with "Booking by chat is temporarily
  unavailable. Please use the business booking page instead." once it is 80 or more. The reminder and booking-email
  behaviour of the existing services is untouched.

  **Projected-load guard (cross-day accumulation).** Reminders are never budget-gated, and a sent-today count cannot see
  emails that are only QUEUED. Without more, 20 bookings a day for three days, all aimed at one target date, would queue
  120 reminders (H24 + H2 each) for that date, over Resend's ~100 a day, and real reminders would be rejected. So
  `create_booking` also checks the two UTC days its emails will land on: the H24 email is due on the UTC day of
  (start - 24 h) and the H2 email on the UTC day of (start - 2 h) (see `reminderWindows.ts`; the day boundaries reminders.ts uses for its daily
  budget). When both fall on the same UTC day (a start between 00:00 and 02:00 UTC) that single day takes TWO emails (load + 2 reaches 70); otherwise each day takes one. For each day it counts, across ALL tenants (the one allowed global count,
  `reminderJobRepo.emailLoadForUtcDay`, using the (status, dueAt) index), email jobs still PENDING or SENDING with
  `dueAt` on that day plus emails already SENT that day (plus waitlist offers for today), and refuses with "Booking by
  chat is temporarily unavailable for that day. Please use the business booking page instead." when that count plus this
  booking's 1 email would reach `EMAIL_BUDGET_WARN - 10` = 70. The 10 below the warning level leaves room for real
  traffic. A failing count refuses the booking (fail closed). It needs no schema change and no "MCP-created" marker: real
  bookings count toward a day's load too, so the connector backs off as a day fills up for any reason. Worst case on one
  day is therefore about 70 plus the unavoidable race between two simultaneous checks, still under 100. The sent-today
  guard (80) stays. `join_waitlist` has no such guard: a join queues no email, and the offer email it may later cause
  lands on an unknown day; it is bounded by its own caps (40 a day) and by the sent-today guard.

  **Shared fate (accepted for the rollout).** The hour and day caps are global, so an anonymous caller CAN use them up
  and make chat booking unavailable for everyone until the window rolls over (the next UTC day for the day caps). The
  alternative would be letting a script starve real reminders. One attacker can use up the 20 bookings a day for everyone, but only with valid, fully formed bookings (a real slot, a prepared token, a valid phone and a fresh email each, at most 2 per email per day), so the damage is bounded by the email caps above. `MCP_ENABLED` is the emergency stop. Knobs: the numbers in
  `RATE_POLICIES` (`mcp*`) and `EMAIL_BUDGET_WARN` in `reminders.ts`.

  **When limited** the answer is an `isError` result "Too many requests right now. Try again in N minutes." (HTTP 200;
  a 429 for the whole request would reach the person as a generic transport error). **Limiter store down**: reads fail open
  (logged as `rate_limit_fail_open`), writes fail closed with "Booking is paused for a few minutes...". Each limiter
  call is one atomic upsert guarded by a 300 ms client-side timeout (`RATE_LIMIT_TIMEOUT_MS`); there is no server-side
  `statement_timeout` (the pool has none). A read costs 2 limiter queries, a booking about 7 plus the booking itself;
  `initialize`, `ping`, `server/discover` and `tools/list` do no database work (tested). Not added (it would need a
  counter or a migration): "open future bookings per phone". The web route's own per-phone probe budget
  (`bookingPhone`) still applies inside the booking service.
- **Sanitizing / prompt injection**: tool descriptions are static. Every business-entered string (business, service and staff
  names, address) is cleaned (`sanitize.ts`): control and bidi/invisible characters and Unicode tags removed, markup characters
  removed, whitespace collapsed, capped at 80 (200 for addresses) and returned as a data field, quoted when it appears in prose.
- **Privacy**: no notes or free-text columns are added. Tool arguments and results are never logged (log line: tool, businessId,
  slug, outcome, duration, requestId). The logger redacts `confirmationToken`, `phone`, `email` as a safety net; Sentry's
  scrubber already drops `token`, `phone`, `email` keys. Unexpected failures answer a plain retry text with no internals.
- **Unauthenticated handles** (`confirmationToken`, manage links) are bearer tokens: high entropy HMAC, 10 minutes (prepare) or
  until the appointment start (manage link), stated in the descriptions.
- Origin rule, size cap, content type, no sessions: see Protocol.

## Limits

Claude accepts about 150,000 characters per result and allows 240 s per call. Our results are small (lists capped: 10
businesses, 60 times); results above 100,000 characters become an error. `clientInfo` is never used for decisions.

## Environment

| Variable | Meaning |
| --- | --- |
| `MCP_ENABLED` | `true` turns the connector, `/assistant` and the footer link on. Anything else is off. Default off. |
| `MCP_ALLOWED_ORIGINS` | Optional comma-separated extra https origins allowed when a request carries an `Origin`. |

Flip the variable in Vercel, then **redeploy** (the footer and page read it per request, but the value is baked into the
deployment's environment).

## How to test

```
npx @modelcontextprotocol/inspector --cli <url>/api/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli <url>/api/mcp --transport http --method tools/call --tool-name search_businesses --tool-arg limit=3
```

A 2026-07-28 request by hand: POST with `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/list` and body
`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}`.
In Claude: Customize > Connectors > Add custom connector (a free plan allows one), paste `https://<site>/api/mcp`, check the
tools under Tool permissions (reads run without prompts; the four writes prompt), then ask "Find a barber in Beirut".

## Rollout (owner)

1. Merge PR-15a and let it deploy (the connector is OFF).
2. In Vercel set `MCP_ENABLED=true` (Production), then redeploy.
3. Open `/assistant`; run the two Inspector commands against the live URL.
4. Add the connector in your own Claude and do one real booking with a test business, then cancel it.
5. Announce.

## Honest unknowns

- Which protocol version Claude's client really negotiates today (unknown until tried with the real client) (we serve both; the legacy flow is the documented one).
- Whether the Vercel Firewall or any WAF rule blocks Anthropic's server-side requests (no Origin, a few shared IPs).
- Claude's UI labels (Customize, Connectors) may be renamed; the page and FAQ copy would then need a one-line edit.
- Behaviour of long chats: the tools are stateless, so a stale `confirmationToken` (over 10 minutes) simply needs a new prepare.

## Next version

Owner tools through Claude's lazy authentication in the same connector, a Claude directory listing, ChatGPT.

## Entry points (PR-15b)

All of them follow the same switch as the endpoint and the page: `isAssistantEnabled()` (`MCP_ENABLED` exactly `true`). Off: none of them renders and the existing pages behave as before. The routes were already dynamic (the layout reads cookies), so the flag is read per request and no static page became dynamic (route table before and after: `/`, `/b/[slug]`, `/how-it-works`, `/for-business`, `/assistant`, `/app/share` all dynamic).

- Home `/`: a slim strip to `/assistant` between the hero and the categories.
- Booking page `/b/[slug]`: "Book with Claude" button and sheet, only when the business is LISTED. `GET /api/public/{slug}` gained an additive `business.listed` boolean (OpenAPI regenerated; an older server or a mock without it reads as `false`, so the button stays hidden). The sheet holds a prefilled, read-only prompt with the quoted business name (sanitized by `src/server/mcp/sanitize.ts` `quote`: no control, bidi or zero-width characters, Markdown and HTML characters removed, whitespace collapsed, 80 characters), a Copy button, a link to `/assistant`, an "Open Claude" link to `https://claude.ai` (no prefill parameter) and "Claude normally asks your approval before it books."
- Booking link page `/app/share` (owner): the card "Let clients book from Claude": listed businesses get a share message, Copy, WhatsApp and a QR code to `/assistant`; unlisted ones a note and a link to the listing switch. The message avoids a comma after URLs so chat apps do not swallow punctuation into the link.
- `/assistant`: an "Illustration" demo chat with made-up names (decorative, `aria-hidden`).

### Guard edge fix

`guardProjectedLoad` now computes the two due days as `utcDayStart(start - 24 h)` (H24) and `utcDayStart(start - 2 h)` (H2), as `reminderWindows.ts` schedules them. For a start between 00:00 and 02:00 UTC both land on the same (previous) UTC day, which is checked once with `load + 2 >= 70`; otherwise each day is checked with `load + 1 >= 70`. Before, the second day was the UTC day of the start itself, so that edge under-counted by one. Proof: `tests/unit/mcp/guardProjectedLoad.test.ts` (01:00 UTC with 68 refuses and 67 allows; 12:00 and 23:30 UTC unchanged; 02:00 UTC exactly is two days) and the existing `tests/integration/mcp.limits.test.ts`.
