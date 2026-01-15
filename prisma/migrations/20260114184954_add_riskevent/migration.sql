/*
  Warnings:

  - You are about to drop the column `eventAt` on the `RiskEvent` table. All the data in the column will be lost.
  - You are about to drop the column `orderName` on the `RiskEvent` table. All the data in the column will be lost.
  - You are about to drop the column `payloadHash` on the `RiskEvent` table. All the data in the column will be lost.
  - You are about to drop the column `skipReason` on the `RiskEvent` table. All the data in the column will be lost.
  - Added the required column `evaluated` to the `RiskEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reasons` to the `RiskEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `riskLevel` to the `RiskEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `riskScore` to the `RiskEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshot` to the `RiskEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `source` to the `RiskEvent` table without a default value. This is not possible if the table is not empty.
  - Made the column `decision` on table `RiskEvent` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RiskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderNumber" TEXT,
    "source" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "evaluated" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "decision" TEXT NOT NULL
);
INSERT INTO "new_RiskEvent" ("createdAt", "decision", "id", "orderGid", "shop", "topic") SELECT "createdAt", "decision", "id", "orderGid", "shop", "topic" FROM "RiskEvent";
DROP TABLE "RiskEvent";
ALTER TABLE "new_RiskEvent" RENAME TO "RiskEvent";
CREATE INDEX "RiskEvent_shop_orderGid_idx" ON "RiskEvent"("shop", "orderGid");
CREATE INDEX "RiskEvent_shop_createdAt_idx" ON "RiskEvent"("shop", "createdAt");
CREATE INDEX "RiskEvent_shop_orderGid_createdAt_idx" ON "RiskEvent"("shop", "orderGid", "createdAt");
CREATE TABLE "new_RiskResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventId" TEXT,
    "lastTopic" TEXT,
    "lastEventAt" DATETIME,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "payloadHash" TEXT,
    "lastDecision" TEXT,
    "skipReason" TEXT,
    "lastRiskChangeAt" DATETIME,
    CONSTRAINT "RiskResult_lastEventId_fkey" FOREIGN KEY ("lastEventId") REFERENCES "RiskEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RiskResult" ("createdAt", "eventCount", "id", "lastDecision", "lastEventAt", "lastRiskChangeAt", "lastTopic", "orderGid", "orderName", "payloadHash", "reasonsJson", "riskLevel", "score", "shop", "skipReason", "updatedAt") SELECT "createdAt", "eventCount", "id", "lastDecision", "lastEventAt", "lastRiskChangeAt", "lastTopic", "orderGid", "orderName", "payloadHash", "reasonsJson", "riskLevel", "score", "shop", "skipReason", "updatedAt" FROM "RiskResult";
DROP TABLE "RiskResult";
ALTER TABLE "new_RiskResult" RENAME TO "RiskResult";
CREATE INDEX "RiskResult_shop_createdAt_idx" ON "RiskResult"("shop", "createdAt");
CREATE INDEX "RiskResult_shop_lastEventAt_idx" ON "RiskResult"("shop", "lastEventAt");
CREATE INDEX "RiskResult_shop_lastRiskChangeAt_idx" ON "RiskResult"("shop", "lastRiskChangeAt");
CREATE UNIQUE INDEX "RiskResult_shop_orderGid_key" ON "RiskResult"("shop", "orderGid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
