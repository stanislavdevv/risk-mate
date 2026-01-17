-- AlterTable
ALTER TABLE "RiskResult" ADD COLUMN "manualDecision" TEXT;
ALTER TABLE "RiskResult" ADD COLUMN "manualDecisionAt" DATETIME;
ALTER TABLE "RiskResult" ADD COLUMN "manualDecisionBy" TEXT;

-- CreateTable
CREATE TABLE "RiskManualDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedByType" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RiskManualDecision_shop_decidedAt_idx" ON "RiskManualDecision"("shop", "decidedAt");

-- CreateIndex
CREATE INDEX "RiskManualDecision_shop_orderGid_decidedAt_idx" ON "RiskManualDecision"("shop", "orderGid", "decidedAt");
