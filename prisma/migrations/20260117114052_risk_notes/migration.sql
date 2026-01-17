-- CreateTable
CREATE TABLE "RiskNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RiskNote_shop_orderGid_createdAt_idx" ON "RiskNote"("shop", "orderGid", "createdAt");
