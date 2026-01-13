-- AlterTable
ALTER TABLE "RiskResult" ADD COLUMN "lastDecision" TEXT;
ALTER TABLE "RiskResult" ADD COLUMN "skipReason" TEXT;

-- CreateIndex
CREATE INDEX "RiskResult_shop_lastEventAt_idx" ON "RiskResult"("shop", "lastEventAt");
