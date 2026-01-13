-- CreateTable
CREATE TABLE "RiskResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RiskResult_shop_createdAt_idx" ON "RiskResult"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "RiskResult_shop_orderGid_idx" ON "RiskResult"("shop", "orderGid");
