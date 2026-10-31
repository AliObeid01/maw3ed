/* eslint-disable */
// Preloaded into the journey server only (NODE_OPTIONS=--require, see playwright.config.ts). The server runs the
// REAL ResendEmailProvider; this stub answers the one HTTPS call it makes to api.resend.com, like Resend does:
//  - same Idempotency-Key + same payload  -> the original answer, nothing delivered again
//  - same key + different payload         -> 409 invalid_idempotent_request
// and appends every accepted request as one JSON line to E2E_EMAIL_OUTBOX_FILE so a browser test can read the
// exact email the server produced. Nothing leaves the machine. Every other fetch passes through untouched.
const fs = require('node:fs');
const crypto = require('node:crypto');

const file = process.env.E2E_EMAIL_OUTBOX_FILE;
const realFetch = globalThis.fetch;
const accepted = new Map(); // idempotency key -> { hash, id }
let sequence = 0;

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

if (file) {
  globalThis.fetch = async function stubbedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== 'https://api.resend.com/emails') return realFetch(input, init);

    const headers = new Headers(init && init.headers);
    const key = headers.get('idempotency-key') || '';
    const raw = String(init && init.body);
    const payload = JSON.parse(raw);
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const seen = key ? accepted.get(key) : undefined;
    if (seen && seen.hash !== hash)
      return reply(409, { name: 'invalid_idempotent_request', message: 'key reused with another payload' });
    const id = seen ? seen.id : `stub-${process.pid}-${++sequence}`;
    if (!seen && key) accepted.set(key, { hash, id });
    fs.appendFileSync(
      file,
      JSON.stringify({
        to: Array.isArray(payload.to) ? payload.to[0] : payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        idempotencyKey: key,
        duplicate: Boolean(seen),
        providerMessageId: id,
      }) + '\n',
    );
    return reply(200, { id });
  };
}
