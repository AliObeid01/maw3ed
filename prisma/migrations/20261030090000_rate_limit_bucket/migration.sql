-- Additive only: shared fixed-window rate limiter state (works across serverless instances).
-- No foreign keys on purpose: keys are hashed emails / IPs, not tenants. Cleaned up by /api/jobs/cleanup.
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");
