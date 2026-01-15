-- Add rulesVersion to RiskEvent
ALTER TABLE "RiskEvent" ADD COLUMN "rulesVersion" TEXT NOT NULL DEFAULT 'unknown';
