import type { RiskLevel } from "./types";

export const DEFAULT_THRESHOLDS = {
  HIGH: 30,
  MEDIUM: 15,
} as const;

export function calculateRiskLevel(
  score: number,
  thresholds = DEFAULT_THRESHOLDS
): RiskLevel {
  if (score >= thresholds.HIGH) return "HIGH";
  if (score >= thresholds.MEDIUM) return "MEDIUM";
  return "LOW";
}
