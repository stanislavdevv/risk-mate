-- AlterTable
ALTER TABLE "RiskResult" ADD COLUMN "lastRiskChangeAt" DATETIME;

-- CreateIndex
CREATE INDEX "RiskResult_shop_lastRiskChangeAt_idx" ON "RiskResult"("shop", "lastRiskChangeAt");
