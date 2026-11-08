import { db } from './db';

/**
 * The logo lives in its own table. Only `readBytes` ever selects the image bytes (the public logo route);
 * every other read takes the hash alone.
 */
export const businessLogoRepo = {
  /** Owner write: the id comes from the session. One row per business; a new upload replaces it. */
  async upsert(
    businessId: string,
    logo: { mime: string; bytes: Buffer; width: number; height: number; hash: string },
    now: Date,
  ) {
    const data = {
      mime: logo.mime,
      bytes: new Uint8Array(logo.bytes),
      width: logo.width,
      height: logo.height,
      hash: logo.hash,
      updatedAt: now,
    };
    await db.businessLogo.upsert({
      where: { businessId },
      create: { businessId, ...data },
      update: data,
    });
  },

  /** Idempotent: true when a row was removed. */
  async remove(businessId: string): Promise<boolean> {
    const res = await db.businessLogo.deleteMany({ where: { businessId } });
    return res.count > 0;
  },

  /** The public version (hash) of one business's logo, or null. Never reads the bytes. */
  async hashFor(businessId: string): Promise<string | null> {
    const row = await db.businessLogo.findUnique({ where: { businessId }, select: { hash: true } });
    return row?.hash ?? null;
  },

  /** Hash and mime by slug (any existing business, listed or not: the logo is public branding). No bytes. */
  findMetaBySlug: (slug: string) =>
    db.businessLogo.findFirst({
      where: { business: { slug } },
      select: { businessId: true, hash: true, mime: true },
    }),

  /** The image itself. Only the public logo route calls this, after the conditional-request check. */
  async readBytes(businessId: string) {
    return db.businessLogo.findUnique({
      where: { businessId },
      select: { bytes: true, hash: true, mime: true },
    });
  },
};
