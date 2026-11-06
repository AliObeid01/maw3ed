-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "area" TEXT;

-- CreateIndex
CREATE INDEX "Business_listed_area_category_idx" ON "Business"("listed", "area", "category");
