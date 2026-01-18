-- CreateTable
CREATE TABLE "BillingTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "trialEndsAt" DATETIME,
    "currentPeriodEnd" DATETIME,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BillingTransition_shop_changedAt_idx" ON "BillingTransition"("shop", "changedAt");
