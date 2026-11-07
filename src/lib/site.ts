/**
 * Public contact details and legal switches, in ONE place.
 *
 * The owner replaces the three PLACEHOLDERS below (email, phone, address) and the governing law in the legal pages
 * before submission. Social links stay hidden until a URL is set here: no dead `#` links are ever rendered.
 */
export const SITE = {
  email: 'hello@[YOUR-DOMAIN]',
  phone: '+961 [XX XXX XXX]',
  address: '[YOUR ADDRESS], Lebanon',
  /** Full https URLs. Empty = the icon is not rendered. */
  social: {
    instagram: '',
    whatsapp: '',
    facebook: '',
  },
} as const;

/** Show the "Draft - under review" notice on /privacy and /terms. The owner or lawyer flips it after review. */
export const LEGAL_DRAFT = true;
/** Last update of both legal pages (ISO date). */
export const LEGAL_UPDATED = '2026-11-07';
/** The footer year is a constant, not the render time. */
export const COPYRIGHT_YEAR = 2026;
/** Placeholder the owner replaces in the Terms. */
export const GOVERNING_LAW = '[GOVERNING LAW]';

export type SocialId = 'instagram' | 'whatsapp' | 'facebook';
export type SocialConfig = Record<SocialId, string>;

const ORDER: SocialId[] = ['instagram', 'whatsapp', 'facebook'];

/** The social links that have a valid https URL, in display order. */
export function socialLinks(config: SocialConfig = SITE.social): { id: SocialId; url: string }[] {
  const out: { id: SocialId; url: string }[] = [];
  for (const id of ORDER) {
    const url = config[id]?.trim();
    if (url && /^https:\/\//i.test(url)) out.push({ id, url });
  }
  return out;
}

/** `mailto:` for the contact link; the placeholder is kept as is until the owner replaces it. */
export const contactHref = (email: string = SITE.email): string => `mailto:${email}`;
