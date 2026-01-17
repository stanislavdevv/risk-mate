-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RiskProcessingError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PROCESSING',
    "topic" TEXT,
    "orderGid" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_RiskProcessingError" ("createdAt", "id", "message", "orderGid", "shop", "topic") SELECT "createdAt", "id", "message", "orderGid", "shop", "topic" FROM "RiskProcessingError";
DROP TABLE "RiskProcessingError";
ALTER TABLE "new_RiskProcessingError" RENAME TO "RiskProcessingError";
CREATE INDEX "RiskProcessingError_shop_createdAt_idx" ON "RiskProcessingError"("shop", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
