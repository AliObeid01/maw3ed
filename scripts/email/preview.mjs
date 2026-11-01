#!/usr/bin/env node
// Renders every transactional email (en and ar) to tmp/email-preview/*.html so you can open them in a browser.
// No network, no secrets, no database. Usage: node scripts/email/preview.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const root = path.resolve(import.meta.dirname, '../..');
const load = (rel) => tsImport(pathToFileURL(path.join(root, rel)).href, import.meta.url);

const { renderReminderEmail } = await load('src/server/i18n/emailRender.ts');
const { renderOfferEmail } = await load('src/server/i18n/offerEmail.ts');
const { inviteEmail } = await load('src/server/providers/email/inviteTemplate.ts');
const { accountEmail } = await load('src/server/providers/email/accountEmails.ts');

const out = path.join(root, 'tmp', 'email-preview');
fs.mkdirSync(out, { recursive: true });

const startAt = new Date('2026-11-04T07:00:00Z');
const base = {
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Rana',
  serviceName: 'Haircut',
  staffName: 'Maya',
  startAt,
};
const files = [];
for (const locale of ['en', 'ar']) {
  for (const kind of ['BOOKING', 'H24', 'H2']) {
    files.push([
      `${kind.toLowerCase()}-${locale}`,
      renderReminderEmail({
        ...base,
        locale,
        kind,
        confirmUrl: 'https://app.example/l/confirm-token.signature',
        cancelUrl: 'https://app.example/l/cancel-token.signature',
      }),
    ]);
  }
  files.push([
    `offer-${locale}`,
    renderOfferEmail({
      ...base,
      locale,
      expiresAt: new Date('2026-11-03T10:30:00Z'),
      claimUrl: 'https://app.example/o/claim-token.signature',
      leaveUrl: 'https://app.example/o/leave-token.signature',
    }),
  ]);
  files.push([
    `invite-${locale}`,
    inviteEmail({
      locale,
      businessName: base.businessName,
      acceptUrl: 'https://app.example/invite/invite-token',
      expiresAt: new Date('2026-11-10T10:00:00Z'),
    }),
  ]);
  for (const kind of ['VERIFY', 'RESET']) {
    files.push([
      `${kind.toLowerCase()}-${locale}`,
      accountEmail({
        kind,
        locale,
        businessName: base.businessName,
        url: `https://app.example/${kind.toLowerCase()}?token=abcdefghijklmnopqrstuvwxyz0123456789`,
      }),
    ]);
  }
}
for (const [name, email] of files) {
  fs.writeFileSync(path.join(out, `${name}.html`), email.html);
}
console.log(`Wrote ${files.length} emails to ${path.relative(root, out)}`);
