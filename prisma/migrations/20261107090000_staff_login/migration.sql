-- Staff (barber) login, part 1. Additive and safe on the populated tables.

-- New role. (A new enum value cannot be used in the same transaction; nothing here uses it.)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRACTITIONER';

-- Phone identity. E-mail becomes optional; every existing row has one, so the CHECK holds.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
ALTER TABLE "User" ADD CONSTRAINT "user_has_identity" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Owner turned a staff login off.
ALTER TABLE "StaffMember" ADD COLUMN "loginOffAt" TIMESTAMPTZ(3);

-- One StaffMember per user per business. Pre-flight: fail loudly with a clear message if duplicates exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "StaffMember" WHERE "userId" IS NOT NULL
    GROUP BY "businessId", "userId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'staff_login migration: duplicate StaffMember(businessId, userId) rows exist; resolve them first';
  END IF;
END $$;
CREATE UNIQUE INDEX "StaffMember_userId_businessId_key" ON "StaffMember"("userId", "businessId") WHERE "userId" IS NOT NULL;

-- One-time activation links (only the sha256 of the token is stored).
CREATE TABLE "ActivationToken" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivationToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActivationToken_tokenHash_key" ON "ActivationToken"("tokenHash");
CREATE INDEX "ActivationToken_businessId_staffMemberId_idx" ON "ActivationToken"("businessId", "staffMemberId");
-- At most one OPEN link per staff member: creating a new link replaces the old one.
CREATE UNIQUE INDEX "ActivationToken_open_staff_key" ON "ActivationToken"("staffMemberId") WHERE "usedAt" IS NULL;
ALTER TABLE "ActivationToken" ADD CONSTRAINT "ActivationToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivationToken" ADD CONSTRAINT "ActivationToken_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivationToken" ADD CONSTRAINT "ActivationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
