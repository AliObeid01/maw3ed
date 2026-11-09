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

Other rules: POST only (GET, DELETE and the rest answer 405 `Allow: POST`); `Content-Type: application/json` (415); body at
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
- **Rate limits** (Postgres limiter, no migration; never per IP, because every Claude user arrives from Anthropic's few
  addresses and the per-IP buckets of the web routes would lock everyone out at once; the directory's per-IP "live" budget is
  also bypassed for the same reason): all tool calls 600 per 10 min (`mcpGlobal`); writes 120 per 10 min (`mcpWrite`);
  per HMAC of the phone, 5 per hour for `create_booking` and `join_waitlist` together (`mcpPhone`); per business 60 bookings
  per hour (`mcpBookBusiness`); business-scoped reads 300 per 10 min (`mcpReadBusiness`). The web route's own per-phone
  probe budget (`bookingPhone`) still applies inside the booking service. Replays and failed attempts are refunded. When
  limited the answer is an `isError` result "Too many requests right now. Try again in N minutes." (HTTP 200; a 429 for the
  whole request would reach the person as a generic transport error). **Limiter store down**: reads fail open (logged as
  `rate_limit_fail_open`), writes fail closed with "Booking is paused for a few minutes…".
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

- Which protocol version Claude's client really negotiates today (we serve both; the legacy flow is the documented one).
- Whether the Vercel Firewall or any WAF rule blocks Anthropic's server-side requests (no Origin, a few shared IPs).
- Claude's UI labels (Customize, Connectors) may be renamed; the page and FAQ copy would then need a one-line edit.
- Behaviour of long chats: the tools are stateless, so a stale `confirmationToken` (over 10 minutes) simply needs a new prepare.

## Next version

Owner tools through Claude's lazy authentication in the same connector, a Claude directory listing, ChatGPT.
