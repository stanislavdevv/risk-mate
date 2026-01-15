-- Add status to RiskRule and create RiskRuleChange log
ALTER TABLE "RiskRule" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "RiskRuleChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT NOT NULL,
    "changedByType" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "RiskRuleChange_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RiskRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RiskRuleChange_shop_changedAt_idx" ON "RiskRuleChange"("shop", "changedAt");
CREATE INDEX "RiskRuleChange_ruleId_changedAt_idx" ON "RiskRuleChange"("ruleId", "changedAt");
CREATE INDEX "RiskRule_shop_status_idx" ON "RiskRule"("shop", "status");
