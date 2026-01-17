-- CreateTable
CREATE TABLE "RiskProcessingError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT,
    "orderGid" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RiskProcessingError_shop_createdAt_idx" ON "RiskProcessingError"("shop", "createdAt");
