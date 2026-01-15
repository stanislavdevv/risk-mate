import prisma from "../db.server";
import { evaluateRules } from "./rules.engine";
import { calculateRiskLevel } from "./riskLevel";
import type { RiskLevel } from "./types";
import { decisionFromRiskLevel, type Decision } from "./decision";

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

function sanitizeReasons(input: any[]): any[] {
  const arr = Array.isArray(input) ? input : [];
  const out: any[] = [];

  for (const r of arr) {
    if (out.length >= MAX_REASONS) break;

    // allow strings like "ORDER_VALUE"
    if (typeof r === "string") {
      out.push(r.slice(0, 120));
      continue;
    }

    // allow {code, details} but clamp length
    if (r && typeof r === "object") {
      const code = typeof (r as any).code === "string" ? (r as any).code.slice(0, 60) : "REASON";
      const details =
        typeof (r as any).details === "string" ? (r as any).details.slice(0, 200) : undefined;

      out.push(details ? { code, details } : { code });
      continue;
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
  reasons: any[];
  reasonsJson: string;
  actions: string[];
  tags: string[]; // keep for compatibility, but MVP-minimal
  facts: { description: string; sentiment: "NEGATIVE" | "NEUTRAL" | "POSITIVE" }[];
}> {
  const rules = await prisma.riskRule.findMany({
    where: { shop, enabled: true },
    orderBy: { createdAt: "asc" },
  });

  const orderTotal = Number((payload as any)?.current_total_price ?? 0);

  const quantity = ((payload as any)?.line_items ?? []).reduce(
    (sum: number, item: any) => sum + Number(item?.quantity ?? 0),
    0
  );

  const ordersCount = (payload as any)?.customer?.orders_count;
  const isFirstOrder = ordersCount === 0 || ordersCount === 1;

  const shippingCountry = (payload as any)?.shipping_address?.country_code as string | undefined;
  const billingCountry = (payload as any)?.billing_address?.country_code as string | undefined;

  const base = evaluateRules(rules, {
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
  const reasons = sanitizeReasons(Array.isArray(base?.reasons) ? base.reasons : []);
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
      ? reasons.slice(0, MAX_FACTS).map((r: any) => ({
          description: `[RiskMate] ${
            typeof r === "string" ? r : typeof r?.code === "string" ? r.code : "RULE_MATCH"
          }`,
          sentiment: "NEGATIVE" as const,
        }))
      : [{ description: "[RiskMate] No rules matched.", sentiment: "NEUTRAL" as const }];

  return {
    score,
    riskLevel,
    decision,
    reasons,
    reasonsJson: safeJson(reasons),
    actions,
    tags: Array.from(tags),
    facts,
  };
}
