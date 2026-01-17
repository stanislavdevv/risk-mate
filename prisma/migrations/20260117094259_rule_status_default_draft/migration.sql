-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RiskRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "action" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_RiskRule" ("action", "createdAt", "enabled", "id", "operator", "points", "shop", "status", "type", "updatedAt", "value") SELECT "action", "createdAt", "enabled", "id", "operator", "points", "shop", "status", "type", "updatedAt", "value" FROM "RiskRule";
DROP TABLE "RiskRule";
ALTER TABLE "new_RiskRule" RENAME TO "RiskRule";
CREATE INDEX "RiskRule_shop_idx" ON "RiskRule"("shop");
CREATE INDEX "RiskRule_shop_status_idx" ON "RiskRule"("shop", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
