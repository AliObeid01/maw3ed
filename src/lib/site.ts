/**
 * Public contact details and legal switches, in ONE place.
 *
 * Contact details are the owner's own business details and are intentionally public. The governing law (Lebanon) is
 * written into the legal messages in both languages. Social links stay hidden until a URL is set here: no dead `#` links are ever rendered.
 */
export const SITE = {
  email: 'hello@maw3edlb.com',
  phone: '+961 81958526',
  address: 'Beirut, Lebanon',
  /** Full https URLs. Empty = the icon is not rendered. */
  social: {
    instagram: '',
    whatsapp: '',
    facebook: '',
  },
} as const;

/** Show the "Draft - under review" notice on /privacy and /terms. Flip it back to true to show the notice again. */
export const LEGAL_DRAFT = false;
/** Last update of both legal pages (ISO date). */
export const LEGAL_UPDATED = '2026-11-07';
/** The footer year is a constant, not the render time. */
export const COPYRIGHT_YEAR = 2026;

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

/** `mailto:` for the contact link. */
export const contactHref = (email: string = SITE.email): string => `mailto:${email}`;
