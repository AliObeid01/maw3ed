import { logoUrlFor } from '@/lib/business/logoUrl';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { businessLogoRepo } from '@/server/repositories/businessLogo.repo';
import { businessRepo } from '@/server/repositories/business.repo';
import { processLogo } from './logoImage';

export type PublicLogo =
  | { status: 'notModified'; etag: string; immutable: boolean }
  | { status: 'ok'; etag: string; immutable: boolean; mime: string; bytes: Uint8Array };

/** `If-None-Match` may carry several validators, weak ones, or `*`. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}

export const logoService = {
  /** OWNER only. Re-encodes the upload and replaces the business's logo. */
  async put(ctx: SessionContext, imageBase64: string, now: () => Date = () => new Date()) {
    requireRole(ctx, 'OWNER');
    const input = Buffer.from(imageBase64, 'base64');
    const logo = await processLogo(input);
    const business = await businessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    await businessLogoRepo.upsert(ctx.businessId, logo, now());
    ctx.logger.info(
      { inputBytes: input.length, storedBytes: logo.bytes.length, hash: logo.hash.slice(0, 8) },
      'logo stored',
    );
    return { logoUrl: logoUrlFor(business.slug, logo.hash) };
  },

  /** OWNER only. Idempotent: removing a missing logo is fine. */
  async remove(ctx: SessionContext) {
    requireRole(ctx, 'OWNER');
    await businessLogoRepo.remove(ctx.businessId);
  },

  /**
   * Public read by slug. `v` is the version from the DTO url: when it is a prefix of the current hash the answer
   * may be cached for a year (the URL changes with the image). Anything else is cached 5 minutes. A matching
   * `If-None-Match` is answered without reading the bytes.
   */
  async serve(
    slug: string,
    opts: { v?: string | undefined; ifNoneMatch?: string | undefined },
  ): Promise<PublicLogo> {
    const meta = await businessLogoRepo.findMetaBySlug(slug);
    if (!meta) throw AppError.notFound();
    const etag = `"${meta.hash}"`;
    const immutable =
      opts.v !== undefined &&
      opts.v.length >= 8 &&
      meta.hash.startsWith(opts.v);
    if (matches(opts.ifNoneMatch, etag)) return { status: 'notModified', etag, immutable };
    const row = await businessLogoRepo.readBytes(meta.businessId);
    if (!row) throw AppError.notFound();
    return { status: 'ok', etag: `"${row.hash}"`, immutable, mime: row.mime, bytes: row.bytes };
  },
};
