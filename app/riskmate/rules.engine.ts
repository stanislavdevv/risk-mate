import type { RiskRule } from "@prisma/client";
import type { RiskLevel } from "./types";

type OrderContext = {
  orderTotal: number;
  isFirstOrder: boolean;
  shippingCountry?: string;
  billingCountry?: string;
  quantity: number;
};

export type RuleFactor = {
  type: "RULE";
  label: string;
  description: string;
  ruleKey: string;
  weight: number;
  evidence: Record<string, string | number | boolean | null>;
  ruleType: string;
  operator: string;
  value: string;
  action: string | null;
  status: string;
};

function buildEvidence(rule: RiskRule, ctx: OrderContext) {
  switch (rule.type) {
    case "ORDER_VALUE":
      return { orderTotal: ctx.orderTotal };
    case "FIRST_TIME":
      return { isFirstOrder: ctx.isFirstOrder };
    case "HIGH_QTY":
      return { quantity: ctx.quantity };
    case "COUNTRY_MISMATCH":
      return { shippingCountry: ctx.shippingCountry ?? null, billingCountry: ctx.billingCountry ?? null };
    default:
      return {};
  }
}

export function evaluateRules(rules: RiskRule[], ctx: OrderContext) {
  let score = 0;
  const actions: string[] = [];
  const factors: RuleFactor[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    let match = false;

    switch (rule.type) {
      case "ORDER_VALUE":
        match = ctx.orderTotal > Number(rule.value);
        break;

      case "FIRST_TIME":
        match = ctx.isFirstOrder === (rule.value === "true");
        break;

      case "HIGH_QTY":
        match = ctx.quantity >= Number(rule.value);
        break;

      case "COUNTRY_MISMATCH":
        match =
          Boolean(ctx.shippingCountry) &&
          Boolean(ctx.billingCountry) &&
          ctx.shippingCountry !== ctx.billingCountry;
        break;
    }

    if (match) {
      score += rule.points;
      factors.push({
        type: "RULE",
        label: rule.type,
        description: `${rule.type} ${rule.operator} ${rule.value}`,
        ruleKey: rule.id,
        weight: rule.points,
        evidence: buildEvidence(rule, ctx),
        ruleType: rule.type,
        operator: rule.operator,
        value: rule.value,
        action: rule.action ?? null,
        status: rule.status,
      });
      if (rule.action) actions.push(rule.action);
    }
  }

  return { score, actions, factors };
}
