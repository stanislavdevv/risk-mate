import type { RiskRule } from "@prisma/client";
import type { RiskLevel } from "./types";


type OrderContext = {
  orderTotal: number;
  isFirstOrder: boolean;
  shippingCountry?: string;
  quantity: number;
};

export function evaluateRules(
  rules: RiskRule[],
  ctx: OrderContext
) {
  let score = 0;
  const actions: string[] = [];
  const reasons: string[] = [];

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
    }

    if (match) {
      score += rule.points;
      reasons.push(rule.type);
      if (rule.action) actions.push(rule.action);
    }
  }

  return { score, actions, reasons };
}
