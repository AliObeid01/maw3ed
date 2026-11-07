/**
 * The sections of the two legal pages. Text lives in `legal.<doc>.sections.<id>` as `title`, paragraphs `p1..pN`
 * and bullets `b1..bN`; `tests/unit/home/legal.test.ts` keeps these counts in step with both message files.
 * Paragraphs come first, then the bullets, then any further paragraphs listed in `after`.
 */
export type LegalSection = { id: string; p: number; b?: number; after?: number };

export const PRIVACY_SECTIONS: LegalSection[] = [
  { id: 'who', p: 2 },
  { id: 'collect', p: 1, b: 4, after: 1 },
  { id: 'business', p: 1 },
  { id: 'use', p: 1, b: 4 },
  { id: 'reminders', p: 2 },
  { id: 'sharing', p: 1, b: 4, after: 1 },
  { id: 'cookies', p: 1 },
  { id: 'keep', p: 2 },
  { id: 'security', p: 1 },
  { id: 'children', p: 1 },
  { id: 'transfers', p: 1 },
  { id: 'rights', p: 1 },
  { id: 'changes', p: 1 },
  { id: 'contact', p: 1 },
];

export const TERMS_SECTIONS: LegalSection[] = [
  { id: 'about', p: 1 },
  { id: 'clients', p: 1 },
  { id: 'businesses', p: 2 },
  { id: 'cancellations', p: 1 },
  { id: 'availability', p: 1 },
  { id: 'acceptable', p: 1, b: 4 },
  { id: 'plans', p: 1 },
  { id: 'liability', p: 1 },
  { id: 'termination', p: 1 },
  { id: 'law', p: 1 },
  { id: 'changes', p: 1 },
  { id: 'contact', p: 1 },
];

/** Message keys of every paragraph (`p1`, `p2`...) and bullet (`b1`...) a section uses, in key order. */
export function legalKeys(s: LegalSection): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= s.p; i++) keys.push(`p${i}`);
  for (let i = 1; i <= (s.b ?? 0); i++) keys.push(`b${i}`);
  for (let i = 1; i <= (s.after ?? 0); i++) keys.push(`p${s.p + i}`);
  return keys;
}
