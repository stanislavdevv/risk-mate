-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RiskResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_RiskResult" ("createdAt", "id", "orderGid", "orderName", "reasonsJson", "riskLevel", "score", "shop") SELECT "createdAt", "id", "orderGid", "orderName", "reasonsJson", "riskLevel", "score", "shop" FROM "RiskResult";
DROP TABLE "RiskResult";
ALTER TABLE "new_RiskResult" RENAME TO "RiskResult";
CREATE INDEX "RiskResult_shop_createdAt_idx" ON "RiskResult"("shop", "createdAt");
CREATE UNIQUE INDEX "RiskResult_shop_orderGid_key" ON "RiskResult"("shop", "orderGid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
