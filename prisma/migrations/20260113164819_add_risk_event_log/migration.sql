-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "eventAt" DATETIME NOT NULL,
    "payloadHash" TEXT,
    "decision" TEXT,
    "skipReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RiskEvent_shop_createdAt_idx" ON "RiskEvent"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvent_shop_orderGid_createdAt_idx" ON "RiskEvent"("shop", "orderGid", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvent_shop_eventAt_idx" ON "RiskEvent"("shop", "eventAt");
