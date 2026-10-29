-- Additive only: opt-in public directory listing. Unlisted businesses keep working by direct link.
ALTER TABLE "Business" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT false;
