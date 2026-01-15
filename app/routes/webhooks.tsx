// app/routes/webhooks.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

import { cleanupOnUninstall } from "../riskmate/cleanup.server";
import { computeRiskFromWebhookPayload } from "../riskmate/riskEngine.server";
import { upsertRiskIfChanged } from "../riskmate/riskStore.server";
import { createOrderRiskAssessment } from "../riskmate/orderRiskAssessment.server";
import { setOrderRiskTags } from "../riskmate/shopifyActions.server";

import crypto from "crypto";
import prisma from "../db.server";

// ---------------- helpers ----------------

function normalizeTopic(topic: unknown) {
  const t = String(topic ?? "").toLowerCase().trim();
  if (t === "orders_paid") return "orders/paid";
  if (t === "orders_create") return "orders/create";
  if (t === "orders_updated") return "orders/updated";
  return t;
}

/**
 * Важно: hash считаем только по “важным” полям.
 * Это даёт идемпотентность и не триггерит пересчёт/сайд-эффекты на мусорные апдейты.
 * (и при этом не хранит protected data)
 */
function pickStableRiskFields(payload: any) {
  return {
    id: payload?.id,
    name: payload?.name,
    total: payload?.current_total_price ?? payload?.total_price ?? null,
    currency: payload?.currency ?? null,
    qty: Array.isArray(payload?.line_items)
      ? payload.line_items.reduce((s: number, x: any) => s + Number(x?.quantity ?? 0), 0)
      : 0,
    shippingCountry: payload?.shipping_address?.country_code ?? null,
    billingCountry: payload?.billing_address?.country_code ?? null,
    customerOrdersCount: payload?.customer?.orders_count ?? null,
    // намеренно НЕ добавляем email/zip/phone/name/address1 (protected)
  };
}

function sha1(obj: any) {
  const s = JSON.stringify(obj);
  return crypto.createHash("sha1").update(s).digest("hex");
}

function webhookIdFromHeaders(request: Request): string | null {
  const h = request.headers;
  return h.get("x-shopify-webhook-id") || h.get("X-Shopify-Webhook-Id") || null;
}

function topicToSource(t: string): "ORDERS_CREATE" | "ORDERS_UPDATED" | null {
  if (t === "orders/create") return "ORDERS_CREATE";
  if (t === "orders/updated") return "ORDERS_UPDATED";
  return null;
}

function normalizeRiskLevel(level: any): "LOW" | "MEDIUM" | "HIGH" {
  const v = String(level ?? "").toUpperCase();
  if (v === "HIGH") return "HIGH";
  if (v === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function buildReasonsV2FromString(reasonsJson: string | null | undefined) {
  if (!reasonsJson) return { summary: "No reasons provided", factors: [] as any[] };

  try {
    const parsed = JSON.parse(reasonsJson);

    // already v2
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).factors)) {
      return parsed;
    }

    // array legacy
    if (Array.isArray(parsed)) {
      return {
        summary: "Risk reasons",
        factors: parsed.map((x) => ({ label: String(x) })),
      };
    }

    // object but not v2
    return { summary: "Risk reasons", factors: [{ label: JSON.stringify(parsed) }] };
  } catch {
    // plain string
    return { summary: "Risk reasons", factors: [{ label: String(reasonsJson) }] };
  }
}

// ---------------- route ----------------

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { topic, shop, payload, admin } = await authenticate.webhook(request);
    const t = normalizeTopic(topic);

    console.log("[RiskMate] webhook received", { shop, topic: t });

    // app/uninstalled
    if (t === "app/uninstalled") {
      await cleanupOnUninstall(shop);
      return new Response("OK");
    }

    // only create/update for now (paid can stay in allow-list but we won't map it to source)
    const allowed = new Set(["orders/create", "orders/updated", "orders/paid"]);
    if (!allowed.has(t)) return new Response("OK");

    const orderGid = (payload as any)?.admin_graphql_api_id as string | undefined;
    const orderName = (payload as any)?.name as string | undefined;

    if (!orderGid) {
      console.warn("[RiskMate] order webhook without admin_graphql_api_id", { shop, topic: t });
      return new Response("OK");
    }

    console.log("[RiskMate] order event", { shop, topic: t, orderGid, orderName });

    // ---- stable hash + eventAt ----
    const stable = pickStableRiskFields(payload);
    const payloadHash = sha1(stable);

    const eventAt =
      (payload as any)?.updated_at
        ? new Date((payload as any).updated_at)
        : (payload as any)?.processed_at
          ? new Date((payload as any).processed_at)
          : new Date();

    // ---- out-of-order guard ----
    const existing = await prisma.riskResult.findUnique({
      where: { shop_orderGid: { shop, orderGid } },
      select: { lastEventAt: true, riskLevel: true },
    });

    if (existing?.lastEventAt && existing.lastEventAt.getTime() > eventAt.getTime()) {
      // update trust fields only
      await prisma.riskResult.update({
        where: { shop_orderGid: { shop, orderGid } },
        data: {
          lastTopic: t,
          lastEventAt: eventAt,
          eventCount: { increment: 1 },
          orderName: orderName ?? "",
        },
      });

      // still append RiskEvent (central log)
      const source = topicToSource(t);
      if (source) {

        await prisma.riskEvent.create({
          data: {
            shop,
            orderGid,
            orderNumber: orderName ?? null,
            source,
            topic: t,
            webhookId: webhookIdFromHeaders(request),

            snapshot: stable, // safe snapshot
            evaluated: [], // not computed
            reasons: { summary: "Skipped: out of order", factors: [] },

            riskScore: 0,
            riskLevel: "LOW",
            decision: "ALLOW",
          },
        });
      }

      console.log("[RiskMate] out-of-order -> skip", { shop, orderGid, topic: t });
      return new Response("OK");
    }

    // 1) Compute risk (движок может учитывать topic внутри)
    const computed = await computeRiskFromWebhookPayload(shop, payload, t);

    const riskScore = Number(computed?.score ?? 0);
    const riskLevel = normalizeRiskLevel(computed?.riskLevel);
    const reasonsV2 = buildReasonsV2FromString(computed?.reasonsJson ?? null);

    // 2) Store (idempotent) + decide side-effects
    const store = await upsertRiskIfChanged({
      shop,
      orderGid,
      orderName: orderName ?? "",
      score: riskScore,
      riskLevel,
      reasonsJson: computed?.reasonsJson ?? JSON.stringify(reasonsV2),

      payloadHash,
      lastTopic: t,
      lastEventAt: eventAt,
    });

    // 3) Append RiskEvent ALWAYS (central log)
    // source is required in RiskEvent => only create/update are supported as true RiskEvents
    const source = topicToSource(t);
    if (source) {
      const eventReasons = store.skipped
        ? { summary: "Skipped: unchanged", factors: [] }
        : reasonsV2;
      const decision =
        riskLevel === "HIGH" ? "HOLD" :
          riskLevel === "MEDIUM" ? "REVIEW" :
            "ALLOW";

      await prisma.riskEvent.create({
        data: {
          shop,
          orderGid,
          orderNumber: orderName ?? null,

          source,
          topic: t,
          webhookId: webhookIdFromHeaders(request),

          snapshot: stable, // safe snapshot (можно заменить на более широкий safe snapshot позже)
          evaluated: computed?.evaluatedRules ?? [], // если у тебя движок начнёт отдавать — подхватим
          reasons: eventReasons,

          riskScore: store.skipped ? 0 : riskScore,
          riskLevel: store.skipped ? "LOW" : (riskLevel as any),
          decision,
        },
      });
    }

    if (store.skipped) {
      console.log("[RiskMate] unchanged (hash) -> skip side-effects", { shop, orderGid, orderName });
      return new Response("OK");
    }

    // 4) Side-effects in Shopify (только если реально изменился risk)
    await setOrderRiskTags(admin, orderGid, {
      level: riskLevel,
      extra: [], // MVP: никаких дополнительных тегов
      cleanStatusTags: true,
    });

    await createOrderRiskAssessment(admin, orderGid, riskLevel, computed?.facts);

    return new Response("OK");
  } catch (err: any) {
    console.error("[RiskMate] webhook error", err?.message ?? err, err?.stack ?? "");
    // Shopify webhooks: всегда 200 OK, чтобы не было бесконечных ретраев
    return new Response("OK");
  }
}
