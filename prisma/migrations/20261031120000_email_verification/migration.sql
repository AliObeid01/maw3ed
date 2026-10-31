-- Additive only: e-mail verification (L4) and single-use account e-mail tokens (verify + password reset, A1).
-- Safe on the populated production database: one nullable column, one new table, no rewrites of big tables.

-- 1. Users: when the address was proven. NULL = unverified.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3);

-- 2. One-time backfill: every user that exists today is treated as verified (they already work and sign in).
--    Only rows still NULL are touched, so re-running changes nothing.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- 3. Tokens. Only the sha256 of the token is stored; the token itself exists only in the e-mailed link.
CREATE TYPE "EmailTokenKind" AS ENUM ('VERIFY', 'RESET');

CREATE TABLE "EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "EmailTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");
-- "invalidate the older unused tokens of this kind for this user"
CREATE INDEX "EmailToken_userId_kind_idx" ON "EmailToken"("userId", "kind");
-- cleanup job: expired or used tokens
CREATE INDEX "EmailToken_expiresAt_idx" ON "EmailToken"("expiresAt");

ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
