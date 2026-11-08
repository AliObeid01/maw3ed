/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import sharp from 'sharp';
import { DELETE as deleteLogo, PUT as putLogo } from '@/app/api/business/logo/route';
import { GET as getBusiness } from '@/app/api/business/route';
import { GET as directory } from '@/app/api/public/directory/route';
import { GET as publicPage } from '@/app/api/public/[slug]/route';
import { GET as publicLogo } from '@/app/api/public/[slug]/logo/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { businessLogoRepo } from '@/server/repositories/businessLogo.repo';
import { call, PASSWORD, signup } from './helpers/api';
import { activatedPractitioner } from './helpers/practitioner';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { makeBusiness } from './helpers/directory';
import { countStatements } from './helpers/queryCount';

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
  fakeEmailProvider.reset();
});

const png = async (color = '#336699', w = 120, h = 80) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const b64 = (buf: Buffer) => buf.toString('base64');

const upload = (cookie: string | undefined, image: unknown, extra: Record<string, unknown> = {}) =>
  call(putLogo, '/api/business/logo', { method: 'PUT', cookie, body: { image, ...extra } });

/** The public GET returns an image, so the JSON-parsing test helper cannot be used. */
async function getLogo(slug: string, query = '', headers: Record<string, string> = {}) {
  const res = await publicLogo(
    new Request(`http://localhost/api/public/${slug}/logo${query}`, { headers }),
    { params: Promise.resolve({ slug }) },
  );
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function staffCookie(owner: { cookie: string }) {
  const inv = await call(createInvite, '/api/invites', {
    body: { email: 'recep@example.test', role: 'STAFF' },
    cookie: owner.cookie,
  });
  const token = inv.body!.acceptUrl.split('/invite/')[1];
  const res = await call(acceptInvite, `/api/invites/${token}/accept`, {
    body: { name: 'Reception', password: PASSWORD },
    params: { token },
  });
  return res.cookie as string;
}

const versionOf = (url: string) => new URL(url, 'http://x').searchParams.get('v')!;

describe('PUT /api/business/logo', () => {
  it('stores a 256x256 webp, returns a versioned url and shows it on GET /api/business', async () => {
    const owner = await signup({ businessName: 'Logo Shop', slug: 'logo-shop' });
    const res = await upload(owner.cookie, b64(await png()));
    expect(res.status).toBe(200);
    expect(res.body!.logoUrl).toMatch(/^\/api\/public\/logo-shop\/logo\?v=[0-9a-f]{16}$/);

    const row = await pg.query(
      `SELECT mime, width, height, hash, length(bytes) AS len FROM "BusinessLogo"`,
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({ mime: 'image/webp', width: 256, height: 256 });
    expect(Number(row.rows[0].len)).toBeLessThanOrEqual(150 * 1024);
    expect(row.rows[0].hash.startsWith(versionOf(res.body!.logoUrl))).toBe(true);

    const biz = await call(getBusiness, '/api/business', { cookie: owner.cookie });
    expect(biz.body!.logoUrl).toBe(res.body!.logoUrl);
  });

  it('replacing the logo changes the hash and the url', async () => {
    const owner = await signup({ slug: 'logo-replace' });
    const first = await upload(owner.cookie, b64(await png('#112233')));
    const second = await upload(owner.cookie, b64(await png('#ddeeff')));
    expect(second.status).toBe(200);
    expect(versionOf(second.body!.logoUrl)).not.toBe(versionOf(first.body!.logoUrl));
    expect((await pg.query(`SELECT 1 FROM "BusinessLogo"`)).rowCount).toBe(1);
  });

  it('DELETE removes it (idempotent) and the public url becomes 404', async () => {
    const owner = await signup({ slug: 'logo-delete' });
    await upload(owner.cookie, b64(await png()));
    expect((await getLogo('logo-delete')).res.status).toBe(200);
    const del = await call(deleteLogo, '/api/business/logo', {
      method: 'DELETE',
      cookie: owner.cookie,
    });
    expect(del.status).toBe(204);
    const again = await call(deleteLogo, '/api/business/logo', {
      method: 'DELETE',
      cookie: owner.cookie,
    });
    expect(again.status).toBe(204);
    expect((await getLogo('logo-delete')).res.status).toBe(404);
    const biz = await call(getBusiness, '/api/business', { cookie: owner.cookie });
    expect(biz.body!.logoUrl).toBeNull();
  });

  it('is owner only: STAFF and PRACTITIONER get 403, signed-out gets 401', async () => {
    const owner = await signup({ slug: 'logo-roles' });
    const staff = await staffCookie(owner);
    const prac = await activatedPractitioner(owner);
    const body = b64(await png());
    expect((await upload(staff, body)).status).toBe(403);
    expect((await upload(prac.cookie, body)).status).toBe(403);
    expect((await upload(undefined, body)).status).toBe(401);
    for (const cookie of [staff, prac.cookie]) {
      const del = await call(deleteLogo, '/api/business/logo', { method: 'DELETE', cookie });
      expect(del.status).toBe(403);
    }
    expect(
      (await call(deleteLogo, '/api/business/logo', { method: 'DELETE' })).status,
    ).toBe(401);
    expect((await pg.query(`SELECT 1 FROM "BusinessLogo"`)).rowCount).toBe(0);
  });

  it('tenant isolation: owner A only ever touches A; B is unaffected', async () => {
    const a = await signup({ slug: 'iso-a' });
    const b = await signup({ slug: 'iso-b' });
    const bUp = await upload(b.cookie, b64(await png('#aa0000')));
    const bBefore = await getLogo('iso-b', `?v=${versionOf(bUp.body!.logoUrl)}`);

    // A uploads (even with B's slug or id in the body: strict schema rejects it, and the session decides anyway).
    expect((await upload(a.cookie, b64(await png()), { businessId: b.info.business.id })).status).toBe(400);
    expect((await upload(a.cookie, b64(await png('#00aa00')))).status).toBe(200);
    expect((await getLogo('iso-a')).res.status).toBe(200);
    // A deletes its own: B's stays.
    await call(deleteLogo, '/api/business/logo', { method: 'DELETE', cookie: a.cookie });
    expect((await getLogo('iso-a')).res.status).toBe(404);
    const bAfter = await getLogo('iso-b', `?v=${versionOf(bUp.body!.logoUrl)}`);
    expect(bAfter.res.status).toBe(200);
    expect(bAfter.bytes.equals(bBefore.bytes)).toBe(true);
    // A's GET /api/business never shows B's logo.
    const bizA = await call(getBusiness, '/api/business', { cookie: a.cookie });
    expect(bizA.body!.logoUrl).toBeNull();
  });

  it('400s: missing, empty, bad base64, data: prefix, not an image, svg, gif, tiff, corrupt, unknown field', async () => {
    const owner = await signup({ slug: 'logo-400' });
    const c = owner.cookie;
    const fail = async (image: unknown, code: string, extra: Record<string, unknown> = {}) => {
      const r = await upload(c, image, extra);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body!.error.code).toBe(code);
      return r;
    };
    const noImage = await call(putLogo, '/api/business/logo', {
      method: 'PUT',
      cookie: c,
      body: {},
    });
    expect(noImage.status).toBe(400);
    expect(noImage.body!.error.fields.image).toBeTruthy();
    await fail('', 'VALIDATION_FAILED');
    await fail(123, 'VALIDATION_FAILED');
    await fail('not base64 !!!', 'VALIDATION_FAILED');
    await fail(`data:image/png;base64,${b64(await png())}`, 'VALIDATION_FAILED');
    await fail(b64(await png()), 'VALIDATION_FAILED', { extra: 1 });
    await fail(b64(Buffer.from('just some text')), 'UNSUPPORTED_IMAGE');
    await fail(b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')), 'UNSUPPORTED_IMAGE');
    await fail(b64(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary')), 'UNSUPPORTED_IMAGE');
    await fail(b64(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).tiff().toBuffer()), 'UNSUPPORTED_IMAGE');
    await fail(b64((await png()).subarray(0, 50)), 'INVALID_IMAGE');
    // 3 MB + 1 of valid-looking bytes: over the decoded cap.
    const small = await png();
    const big = Buffer.concat([small, Buffer.alloc(3 * 1024 * 1024 - small.length + 10)]);
    await fail(b64(big), 'IMAGE_TOO_LARGE');
    expect((await pg.query(`SELECT 1 FROM "BusinessLogo"`)).rowCount).toBe(0);
  });

  it('rejects a body larger than the route cap with 413', async () => {
    const owner = await signup({ slug: 'logo-413' });
    const r = await upload(owner.cookie, 'A'.repeat(4 * 1024 * 1024 + 2048));
    expect(r.status).toBe(413);
  });

  it('keeps the CSRF protections: JSON content type and Origin check', async () => {
    const owner = await signup({ slug: 'logo-csrf' });
    const body = JSON.stringify({ image: b64(await png()) });
    const text = await call(putLogo, '/api/business/logo', {
      method: 'PUT',
      cookie: owner.cookie,
      headers: { 'content-type': 'text/plain' },
      body: undefined,
    });
    expect(text.status).toBe(415);
    const res = await putLogo(
      new Request('http://localhost/api/business/logo', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie: owner.cookie,
          origin: 'https://evil.example',
        },
        body,
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/public/{slug}/logo', () => {
  async function shop(slug = 'pub-logo') {
    const owner = await signup({ slug });
    const up = await upload(owner.cookie, b64(await png()));
    return { owner, url: up.body!.logoUrl as string, v: versionOf(up.body!.logoUrl) };
  }

  it('serves the webp with the locked-down headers, an ETag and no cookies', async () => {
    const { v } = await shop();
    const { res, bytes } = await getLogo('pub-logo', `?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('set-cookie')).toBeNull();
    const row = await pg.query(`SELECT hash FROM "BusinessLogo"`);
    expect(res.headers.get('etag')).toBe(`"${row.rows[0].hash}"`);
    expect(Number(res.headers.get('content-length'))).toBe(bytes.length);
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
  });

  it('cache-control: immutable only with the current ?v=, otherwise 5 minutes', async () => {
    const { v } = await shop();
    expect((await getLogo('pub-logo', `?v=${v}`)).res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    const expected = 'public, max-age=300, stale-while-revalidate=86400';
    expect((await getLogo('pub-logo')).res.headers.get('cache-control')).toBe(expected);
    expect((await getLogo('pub-logo', '?v=deadbeefdeadbeef')).res.headers.get('cache-control')).toBe(expected);
    expect((await getLogo('pub-logo', `?v=${v.slice(0, 4)}`)).res.headers.get('cache-control')).toBe(expected);
  });

  it('answers 304 to a matching If-None-Match (also weak and lists) without reading the bytes', async () => {
    await shop();
    const first = await getLogo('pub-logo');
    const etag = first.res.headers.get('etag')!;
    const { res, bytes } = await getLogo('pub-logo', '', { 'if-none-match': etag });
    expect(res.status).toBe(304);
    expect(bytes.length).toBe(0);
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    expect((await getLogo('pub-logo', '', { 'if-none-match': `"x", W/${etag}` })).res.status).toBe(304);
    expect((await getLogo('pub-logo', '', { 'if-none-match': '"other"' })).res.status).toBe(200);
    const { statements } = await countStatements(() =>
      getLogo('pub-logo', '', { 'if-none-match': etag }),
    );
    expect(statements.some((s) => /"bytes"/.test(s))).toBe(false);
  });

  it('ETag, Cache-Control and body all come from ONE row: a logo replaced between the two reads is never marked immutable under the old version', async () => {
    const { v } = await shop();
    const real = await businessLogoRepo.readBytes((await businessLogoRepo.findMetaBySlug('pub-logo'))!.businessId);
    // The meta read saw the old hash (v matches it); by the time the bytes are read the logo was replaced.
    const newer = { ...real!, hash: 'f'.repeat(64) };
    const spy = vi.spyOn(businessLogoRepo, 'readBytes').mockResolvedValue(newer);
    try {
      const { res } = await getLogo('pub-logo', `?v=${v}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(`"${'f'.repeat(64)}"`);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=86400');
    } finally {
      spy.mockRestore();
    }
  });

  it('a new upload changes the etag: the old validator no longer matches', async () => {
    const { owner } = await shop();
    const old = (await getLogo('pub-logo')).res.headers.get('etag')!;
    await upload(owner.cookie, b64(await png('#ffcc00')));
    expect((await getLogo('pub-logo', '', { 'if-none-match': old })).res.status).toBe(200);
  });

  it('404 for no logo, unknown slug; 400 for a malformed slug or extra query; works for unlisted businesses', async () => {
    const owner = await signup({ slug: 'no-logo-yet' });
    void owner;
    const none = await getLogo('no-logo-yet');
    expect(none.res.status).toBe(404);
    expect(JSON.parse(none.bytes.toString()).error.code).toBe('NOT_FOUND');
    expect((await getLogo('does-not-exist')).res.status).toBe(404);
    for (const bad of ['..%2f..%2fetc', 'UPPER_case!', 'a', 'x'.repeat(60), "a'b-c", 'ab%00cd']) {
      const r = await getLogo(bad);
      expect(r.res.status, bad).toBe(400);
    }
    expect((await getLogo('no-logo-yet', '?x=1')).res.status).toBe(400);
    // signup businesses are unlisted by default: the logo is still served.
    const { owner: o2 } = await shop('unlisted-shop');
    void o2;
    const listed = await pg.query(`SELECT listed FROM "Business" WHERE slug = 'unlisted-shop'`);
    expect(listed.rows[0].listed).toBe(false);
    expect((await getLogo('unlisted-shop')).res.status).toBe(200);
  });
});

describe('logoUrl in public DTOs', () => {
  it('GET /api/public/{slug} carries logoUrl (string, or null without a logo)', async () => {
    const owner = await signup({ slug: 'dto-shop' });
    const before = await call(publicPage, '/api/public/dto-shop', { params: { slug: 'dto-shop' } });
    expect(before.status).toBe(200);
    expect(before.body!.business.logoUrl).toBeNull();
    const up = await upload(owner.cookie, b64(await png()));
    const after = await call(publicPage, '/api/public/dto-shop', { params: { slug: 'dto-shop' } });
    expect(after.body!.business.logoUrl).toBe(up.body!.logoUrl);
  });

  it('directory items carry logoUrl in every include mode and the query never selects the bytes', async () => {
    const withLogo = await makeBusiness(pg, { name: 'Has Logo', slug: 'has-logo' });
    const without = await makeBusiness(pg, { name: 'No Logo', slug: 'no-logo' });
    const logo = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#123456' } })
      .webp()
      .toBuffer();
    await pg.query(
      `INSERT INTO "BusinessLogo" ("businessId", mime, bytes, width, height, hash, "updatedAt") VALUES ($1,'image/webp',$2,256,256,$3, now())`,
      [withLogo.id, logo, 'ab'.repeat(32)],
    );
    for (const query of [{}, { include: 'services' }, { include: 'nextFree' }, { include: 'nextFree,services' }] as Record<string, string>[]) {
      const { result, statements } = await countStatements(() =>
        call(directory, '/api/public/directory', { query }),
      );
      expect(result.status).toBe(200);
      const items = result.body!.businesses as any[];
      expect(items.find((i) => i.slug === 'has-logo').logoUrl).toBe(
        `/api/public/has-logo/logo?v=${'ab'.repeat(8)}`,
      );
      expect(items.find((i) => i.slug === 'no-logo').logoUrl).toBeNull();
      expect(statements.join('\n')).not.toMatch(/\bl\."bytes"|"BusinessLogo"\."bytes"|\bbytes\b/);
    }
    const soonest = await call(directory, '/api/public/directory', {
      query: { include: 'nextFree', sort: 'soonest' },
    });
    expect(soonest.status).toBe(200);
    for (const i of soonest.body!.businesses as any[]) expect(i).toHaveProperty('logoUrl');
    void without;
  });

  it('a Business query (GET /api/business, public page) never selects bytes', async () => {
    const owner = await signup({ slug: 'bytes-spy' });
    await upload(owner.cookie, b64(await png()));
    const { statements } = await countStatements(async () => {
      await call(getBusiness, '/api/business', { cookie: owner.cookie });
      await call(publicPage, '/api/public/bytes-spy', { params: { slug: 'bytes-spy' } });
    });
    expect(statements.join('\n')).not.toMatch(/"bytes"/);
    vi.restoreAllMocks();
  });

  it('deleting the business cascades to the logo row', async () => {
    const owner = await signup({ slug: 'cascade-shop' });
    await upload(owner.cookie, b64(await png()));
    await pg.query(`DELETE FROM "Business" WHERE slug = 'cascade-shop'`).catch(() => undefined);
    // Other tables reference Business without cascade; the FK itself is checked structurally instead.
    const fk = await pg.query(
      `SELECT confdeltype FROM pg_constraint WHERE conname = 'BusinessLogo_businessId_fkey'`,
    );
    expect(fk.rows[0].confdeltype).toBe('c');
  });
});
