import prisma from "../db.server";
import { evaluateRules, type RuleFactor } from "./rules.engine";
import { calculateRiskLevel } from "./riskLevel";
import type { RiskLevel } from "./types";
import { decisionFromRiskLevel, type Decision } from "./decision";
import { buildRulesetSnapshot, computeRulesVersion } from "./rulesetVersion.server";

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const MAX_REASONS = 20; // в БД и UI
const MAX_FACTS = 10;

function clampScore(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.trunc(n)));
}

function safeJson(v: any) {
  try {
    return JSON.stringify(v ?? []);
  } catch {
    return "[]";
  }
}

function normalizeAction(s: any) {
  return String(s ?? "").trim().toUpperCase();
}

function sanitizeFactors(input: any[]): RuleFactor[] {
  const arr = Array.isArray(input) ? input : [];
  const out: RuleFactor[] = [];

  for (const r of arr) {
    if (out.length >= MAX_REASONS) break;

    if (r && typeof r === "object" && typeof r.ruleKey === "string") {
      const label = typeof r.label === "string" ? r.label.slice(0, 120) : "RULE";
      const description =
        typeof r.description === "string" ? r.description.slice(0, 200) : label;
      const weight = Number.isFinite(r.weight) ? Math.trunc(r.weight) : 0;
      const evidence = r.evidence && typeof r.evidence === "object" ? r.evidence : {};

      const ruleType = typeof r.ruleType === "string" ? r.ruleType : label;
      const operator = typeof r.operator === "string" ? r.operator : "";
      const value = typeof r.value === "string" ? r.value : "";
      const action = typeof r.action === "string" ? r.action : null;
      const status = typeof r.status === "string" ? r.status : "";

      out.push({
        type: "RULE",
        label,
        description,
        ruleKey: String(r.ruleKey),
        weight,
        evidence,
        ruleType,
        operator,
        value,
        action,
        status,
      });
      continue;
    }

    if (typeof r === "string") {
      const text = r.slice(0, 120);
      out.push({
        type: "RULE",
        label: text,
        description: text,
        ruleKey: `legacy:${text}`,
        weight: 0,
        evidence: {},
        ruleType: text,
        operator: "",
        value: "",
        action: null,
        status: "",
      });
    }
  }

  return out;
}

/**
 * Safety policy:
 * - LOW: ignore REVIEW/HOLD from rules
 * - MEDIUM: allow REVIEW only
 * - HIGH: allow HOLD (and REVIEW if you want), but MVP = HOLD
 */
function deriveMvpPolicyTags(level: RiskLevel) {
  if (level === "HIGH") return { review: false, hold: true };
  if (level === "MEDIUM") return { review: true, hold: false };
  return { review: false, hold: false };
}

export async function computeRiskFromWebhookPayload(
  shop: string,
  payload: unknown,
  topic?: string
): Promise<{
  score: number;
  riskLevel: RiskLevel;
  decision: Decision | null;
  reasons: RuleFactor[];
  reasonsJson: string;
  actions: string[];
  tags: string[]; // keep for compatibility, but MVP-minimal
  facts: { description: string; sentiment: "NEGATIVE" | "NEUTRAL" | "POSITIVE" }[];
  rulesVersion: string;
  rulesSnapshot: ReturnType<typeof buildRulesetSnapshot>;
}> {
  const rules = await prisma.riskRule.findMany({
    where: { shop, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  const rulesVersion = computeRulesVersion(rules);
  const rulesSnapshot = buildRulesetSnapshot(rules);
  const enabledRules = rules.filter((rule) => rule.enabled);

  const orderTotal = Number((payload as any)?.current_total_price ?? 0);

  const quantity = ((payload as any)?.line_items ?? []).reduce(
    (sum: number, item: any) => sum + Number(item?.quantity ?? 0),
    0
  );

  const ordersCount = (payload as any)?.customer?.orders_count;
  const isFirstOrder = ordersCount === 0 || ordersCount === 1;

  const shippingCountry = (payload as any)?.shipping_address?.country_code as string | undefined;
  const billingCountry = (payload as any)?.billing_address?.country_code as string | undefined;

  const base = evaluateRules(enabledRules, {
    orderTotal,
    quantity,
    isFirstOrder,
    shippingCountry,
    billingCountry,
    topic, // если вдруг позже захочешь учитывать topic в rules engine
  } as any) as any;

  // 1) Clamp score
  const rawScore = Number(base?.score ?? 0);
  const score = clampScore(rawScore);

  // 2) Sanitize reasons & actions
  const reasons = sanitizeFactors(Array.isArray(base?.factors) ? base.factors : []);
  const actions: string[] = Array.isArray(base?.actions) ? base.actions.map(String) : [];

  // 3) Risk level is derived ONLY from score (policy source of truth)
  const riskLevel = calculateRiskLevel(score);
  const decision = decisionFromRiskLevel(riskLevel);

  // 4) MVP policy tags (minimal)
  // We do NOT honor arbitrary TAG:* actions in MVP.
  // We gate HOLD/REVIEW by level.
  const policy = deriveMvpPolicyTags(riskLevel);

  const tags = new Set<string>();
  tags.add("risk-mate");
  tags.add(`risk:${riskLevel.toLowerCase()}`);

  // If you still want to show rule actions somewhere in UI, keep them in `actions`,
  // but don't translate them to tags here.
  //
  // Optionally: if you want to allow REVIEW/HOLD only when level allows it:
  const wantReview = actions.some((a) => normalizeAction(a) === "REVIEW");
  const wantHold = actions.some((a) => normalizeAction(a) === "HOLD");

  if (policy.review && wantReview) tags.add("risk_review");
  if (policy.hold && wantHold) tags.add("risk_hold");

  // 5) Facts for assessment (short + safe)
  const facts =
    reasons.length > 0
      ? Array.from(new Set(reasons.map((r) => r.label)))
          .slice(0, MAX_FACTS)
          .map((label) => ({
            description: `[RiskMate] ${label}`,
            sentiment: "NEGATIVE" as const,
          }))
      : [{ description: "[RiskMate] No rules matched.", sentiment: "NEUTRAL" as const }];

  const reasonsPayload = {
    summary: reasons.length > 0 ? "Rule matches" : "No rules matched",
    factors: reasons,
  };

  return {
    score,
    riskLevel,
    decision,
    reasons,
    reasonsJson: safeJson(reasonsPayload),
    actions,
    tags: Array.from(tags),
    facts,
    rulesVersion,
    rulesSnapshot,
  };
}

export async function computeRiskFromSnapshot(
  shop: string,
  snapshot: {
    total?: number | string | null;
    qty?: number | string | null;
    shippingCountry?: string | null;
    billingCountry?: string | null;
    customerOrdersCount?: number | null;
  }
) {
  const rules = await prisma.riskRule.findMany({
    where: { shop, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  const rulesVersion = computeRulesVersion(rules);
  const rulesSnapshot = buildRulesetSnapshot(rules);
  const enabledRules = rules.filter((rule) => rule.enabled);

  const orderTotal = Number(snapshot?.total ?? 0);
  const quantity = Number(snapshot?.qty ?? 0);
  const ordersCount = snapshot?.customerOrdersCount;
  const isFirstOrder = ordersCount === 0 || ordersCount === 1;
  const shippingCountry = snapshot?.shippingCountry ?? undefined;
  const billingCountry = snapshot?.billingCountry ?? undefined;

  const base = evaluateRules(enabledRules, {
    orderTotal,
    quantity,
    isFirstOrder,
    shippingCountry,
    billingCountry,
  } as any) as any;

  const rawScore = Number(base?.score ?? 0);
  const score = clampScore(rawScore);
  const reasons = sanitizeFactors(Array.isArray(base?.factors) ? base.factors : []);
  const actions: string[] = Array.isArray(base?.actions) ? base.actions.map(String) : [];

  const riskLevel = calculateRiskLevel(score);
  const decision = decisionFromRiskLevel(riskLevel);
  const policy = deriveMvpPolicyTags(riskLevel);

  const tags = new Set<string>();
  tags.add("risk-mate");
  tags.add(`risk:${riskLevel.toLowerCase()}`);

  const wantReview = actions.some((a) => normalizeAction(a) === "REVIEW");
  const wantHold = actions.some((a) => normalizeAction(a) === "HOLD");

  if (policy.review && wantReview) tags.add("risk_review");
  if (policy.hold && wantHold) tags.add("risk_hold");

  const facts =
    reasons.length > 0
      ? Array.from(new Set(reasons.map((r) => r.label)))
          .slice(0, MAX_FACTS)
          .map((label) => ({
            description: `[RiskMate] ${label}`,
            sentiment: "NEGATIVE" as const,
          }))
      : [{ description: "[RiskMate] No rules matched.", sentiment: "NEUTRAL" as const }];

  const reasonsPayload = {
    summary: reasons.length > 0 ? "Rule matches" : "No rules matched",
    factors: reasons,
  };

  return {
    score,
    riskLevel,
    decision,
    reasons,
    reasonsJson: safeJson(reasonsPayload),
    actions,
    tags: Array.from(tags),
    facts,
    rulesVersion,
    rulesSnapshot,
  };
}
