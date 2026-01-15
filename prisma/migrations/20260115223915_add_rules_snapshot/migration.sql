-- AlterTable
ALTER TABLE "RiskEvent" ADD COLUMN "rulesSnapshot" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RiskRuleChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT NOT NULL,
    "changedByType" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "RiskRuleChange_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RiskRule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RiskRuleChange" ("changedAt", "changedBy", "changedByType", "changes", "id", "ruleId", "shop") SELECT "changedAt", "changedBy", "changedByType", "changes", "id", "ruleId", "shop" FROM "RiskRuleChange";
DROP TABLE "RiskRuleChange";
ALTER TABLE "new_RiskRuleChange" RENAME TO "RiskRuleChange";
CREATE INDEX "RiskRuleChange_shop_changedAt_idx" ON "RiskRuleChange"("shop", "changedAt");
CREATE INDEX "RiskRuleChange_ruleId_changedAt_idx" ON "RiskRuleChange"("ruleId", "changedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
