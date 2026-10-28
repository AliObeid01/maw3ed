const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain invite email. Replaced by react-email later; the shape (subject, text, html) stays. */
export function inviteEmail(opts: { businessName: string; acceptUrl: string; expiresAt: Date }) {
  const expires = opts.expiresAt.toUTCString();
  const subject = `You are invited to join ${opts.businessName} on Maw3ed`;
  const text = [
    `You have been invited to join ${opts.businessName} on Maw3ed.`,
    '',
    `Accept the invitation: ${opts.acceptUrl}`,
    '',
    `This link works once and expires on ${expires}.`,
  ].join('\n');
  const name = escapeHtml(opts.businessName);
  const url = escapeHtml(opts.acceptUrl);
  const html = `<p>You have been invited to join <strong>${name}</strong> on Maw3ed.</p><p><a href="${url}">Accept the invitation</a></p><p>This link works once and expires on ${escapeHtml(expires)}.</p>`;
  return { subject, text, html };
}
