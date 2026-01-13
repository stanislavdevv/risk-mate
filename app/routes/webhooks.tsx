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
    // намеренно НЕ добавляем email/zip/phone (protected data)
  };
}

function sha1(obj: any) {
  const s = JSON.stringify(obj);
  return crypto.createHash("sha1").update(s).digest("hex");
}

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

    // orders/*
    const allowed = new Set(["orders/create", "orders/updated", "orders/paid"]);
    if (!allowed.has(t)) return new Response("OK");

    const orderGid = (payload as any)?.admin_graphql_api_id as string | undefined;
    const orderName = (payload as any)?.name as string | undefined;

    if (!orderGid) {
      console.warn("[RiskMate] order webhook without admin_graphql_api_id", { shop, topic: t });
      return new Response("OK");
    }

    console.log("[RiskMate] order event", { shop, topic: t, orderGid, orderName });

    // ---- NEW: stable hash + trust meta ----
    const stable = pickStableRiskFields(payload);
    const payloadHash = sha1(stable);
    const eventAt =
      (payload as any)?.updated_at
        ? new Date((payload as any).updated_at)
        : (payload as any)?.processed_at
          ? new Date((payload as any).processed_at)
          : new Date();

    // ---- NEW: out-of-order guard (protect from older webhooks overwriting newer) ----
    // If we already saw a newer event for this order, we still record that this event arrived,
    // but we skip risk compute + side-effects.
    const existing = await prisma.riskResult.findUnique({
      where: { shop_orderGid: { shop, orderGid } },
      select: { lastEventAt: true },
    });

    if (existing?.lastEventAt && existing.lastEventAt.getTime() > eventAt.getTime()) {
      // In practice, now is "server receive time", so this mainly protects against weird races
      // if you later switch to Shopify event time.
      await prisma.riskResult.update({
        where: { shop_orderGid: { shop, orderGid } },
        data: {
          lastTopic: t,
          lastEventAt: eventAt,
          eventCount: { increment: 1 },
          lastDecision: "SKIPPED",
          skipReason: "OUT_OF_ORDER",
          orderName: orderName ?? "",
        },
      });

      console.log("[RiskMate] out-of-order -> skip", { shop, orderGid, topic: t });
      return new Response("OK");
    }

    // 1) Compute risk (может учитывать t === orders/paid внутри)
    const computed = await computeRiskFromWebhookPayload(shop, payload, t);

    // 2) Store (idempotent) + decide whether to run side-effects
    //    Важно: store-слой должен:
    //    - всегда инкрементить eventCount и обновлять lastTopic/lastEventAt
    //    - если payloadHash не изменился -> skipped=true (не трогаем score/reasons)
    //    - если изменился -> обновляем score/reasons + payloadHash
    const store = await upsertRiskIfChanged({
      shop,
      orderGid,
      orderName: orderName ?? "",
      score: computed.score,
      riskLevel: computed.riskLevel,
      reasonsJson: computed.reasonsJson,

      // NEW fields
      payloadHash,
      lastTopic: t,
      lastEventAt: eventAt,
    });

    if (store.skipped) {
      console.log("[RiskMate] unchanged (hash) -> skip side-effects", { shop, orderGid, orderName });
      return new Response("OK");
    }

    // 3) Side-effects in Shopify (только когда реально изменился risk)
    await setOrderRiskTags(admin, orderGid, {
      level: computed.riskLevel,
      extra: [], // MVP: никаких дополнительных тегов
      cleanStatusTags: true, // чистим risk_review/risk_hold при смене уровня
    });

    await createOrderRiskAssessment(admin, orderGid, computed.riskLevel, computed.facts);

    return new Response("OK");
  } catch (err: any) {
    console.error("[RiskMate] webhook error", err?.message ?? err, err?.stack ?? "");
    // Shopify webhooks: всегда 200 OK, чтобы не было бесконечных ретраев
    return new Response("OK");
  }
}
