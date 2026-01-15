import type { RiskRule } from "@prisma/client";
import crypto from "crypto";
import prisma from "../db.server";

type RulesetRule = Pick<RiskRule, "type" | "enabled" | "operator" | "value" | "points" | "action">;

type CanonicalRule = {
  ruleKey: string;
  enabled: boolean;
  params: { operator: string; value: string };
  weight: number;
  action: string | null;
};

function canonicalizeRuleset(rules: RulesetRule[]): CanonicalRule[] {
  const normalized = rules.map((rule) => ({
    ruleKey: String(rule.type ?? ""),
    enabled: Boolean(rule.enabled),
    params: {
      operator: String(rule.operator ?? ""),
      value: String(rule.value ?? ""),
    },
    weight: Number.isFinite(rule.points) ? Math.trunc(rule.points) : 0,
    action: rule.action ? String(rule.action) : null,
  }));

  normalized.sort((a, b) => {
    const keyA = [
      a.ruleKey,
      a.enabled ? "1" : "0",
      a.params.operator,
      a.params.value,
      String(a.weight),
      a.action ?? "",
    ].join("|");
    const keyB = [
      b.ruleKey,
      b.enabled ? "1" : "0",
      b.params.operator,
      b.params.value,
      String(b.weight),
      b.action ?? "",
    ].join("|");
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  return normalized;
}

export function computeRulesVersion(rules: RulesetRule[]): string {
  const canonical = canonicalizeRuleset(rules);
  const payload = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function getCurrentRulesVersion(shop: string): Promise<string> {
  const rules = await prisma.riskRule.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });
  return computeRulesVersion(rules);
}
