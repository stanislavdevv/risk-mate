import type { RiskLevel } from "./types";

export type Decision = "ALLOW" | "REVIEW" | "HOLD";

export function decisionFromRiskLevel(level?: RiskLevel | string | null): Decision | null {
  if (level === "HIGH") return "HOLD";
  if (level === "MEDIUM") return "REVIEW";
  if (level === "LOW") return "ALLOW";
  return null;
}
