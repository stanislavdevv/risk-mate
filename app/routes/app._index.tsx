// app/routes/app._index.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { SUPPORTED_LANGS, type Lang, t, parseLang } from "../i18n/strings";
import { computeRulesVersion } from "../riskmate/rulesetVersion.server";

/* ---------- types ---------- */

type RuleType = "ORDER_VALUE" | "FIRST_TIME" | "HIGH_QTY" | "COUNTRY_MISMATCH";
type RuleOp = ">" | ">=" | "=" | "!=" | "<" | "<=";
type RuleStatus = "DRAFT" | "ACTIVE" | "DEPRECATED";

type Rule = {
  id: string;
  type: RuleType;
  operator: RuleOp;
  value: string;
  points: number;
  action: string | null;
  enabled: boolean;
  status: RuleStatus;
  createdAt: string;
};

type RuleChange = {
  id: string;
  ruleId: string;
  changedAt: string;
  changedBy: string;
  changedByType: string;
  changes: Array<{ field: string; from: string | null; to: string | null }>;
};

type RiskEventRow = {
  id: string;
  orderGid: string;
  orderName: string | null;
  topic: string;
  eventAt: string;
  decision: string | null;
  skipReason: string | null;
  orderAdminUrl: string | null; // ✅ добавили ссылку
};

type Row = {
  id: string;
  orderGid: string;
  orderName: string;
  score: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  reasons: any[];
  createdAt: string;
  updatedAt: string;
  orderAdminUrl: string | null;
  rulesVersion: string | null;

  // trust
  lastTopic: string | null;
  lastEventAt: string | null;
  eventCount: number;
  lastRiskChangeAt: string | null;
  lastDecision: string | null;
  skipReason: string | null;
};

type LoaderData = Awaited<ReturnType<typeof loader>>;

type ActionData =
  | { ok: true; op: "addRule"; rule: Rule }
  | { ok: true; op: "seedDefaults"; rules: Rule[] }
  | { ok: true; op: "updateRule"; id: string }
  | { ok: true; op: "toggleRule"; id: string; enabled: boolean }
  | { ok: true; op: "deleteRule"; id: string }
  | { ok: true; op: "loadRuleHistory"; items: RuleChange[]; hasMore: boolean }
  | { ok: false; error: string };

/* ---------- loader ---------- */

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const lang = parseLang(url.searchParams.get("lang"));

  const shopRes = await admin.graphql(`
    query { shop { currencyCode } }
  `);
  const shopJson = await shopRes.json();
  const currency = shopJson?.data?.shop?.currencyCode ?? t(lang, "currencyUnknown");

  const tab = (url.searchParams.get("tab") ?? "orders").toLowerCase();
  const level = (url.searchParams.get("level") ?? "ALL").toUpperCase();

  const rules = await prisma.riskRule.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  const currentRulesVersion = computeRulesVersion(rules.filter((r) => r.status === "ACTIVE"));

  const ruleChanges = await prisma.riskRuleChange.findMany({
    where: { shop: session.shop },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: 6,
  });
  const initialRuleChanges = ruleChanges.slice(0, 5).map((change) => ({
    id: change.id,
    ruleId: change.ruleId,
    changedAt: change.changedAt.toISOString(),
    changedBy: change.changedBy,
    changedByType: change.changedByType,
    changes: Array.isArray(change.changes) ? (change.changes as any) : [],
  }));
  const hasMoreRuleChanges = ruleChanges.length > 5;

  const where: any = { shop: session.shop };
  if (level === "LOW" || level === "MEDIUM" || level === "HIGH") where.riskLevel = level;

  const items = await prisma.riskResult.findMany({
    where,
    orderBy: tab === "events" ? [{ lastEventAt: "desc" }, { updatedAt: "desc" }] : [{ updatedAt: "desc" }],
    take: tab === "events" ? 100 : 50,
  });

  const orderGids = items.map((it) => it.orderGid);
  const latestEventsByOrder = new Map<
    string,
    { decision: string | null; skipReason: string | null; reasonsJson: string | null; rulesVersion: string | null }
  >();

  if (orderGids.length > 0) {
    const orderEvents = await prisma.riskEvent.findMany({
      where: { shop: session.shop, orderGid: { in: orderGids } },
      orderBy: [{ createdAt: "desc" }],
    });

    for (const event of orderEvents) {
      if (!latestEventsByOrder.has(event.orderGid)) {
        const skipReason = normalizeSkipReason((event as any)?.reasons?.summary ?? null);
        const reasonsFromEvent = extractReasonsArray((event as any)?.reasons);
        latestEventsByOrder.set(event.orderGid, {
          decision: event.decision ?? null,
          skipReason: skipReason ?? normalizeSkipReason((event as any).skipReason) ?? null,
          reasonsJson: reasonsFromEvent ? JSON.stringify(reasonsFromEvent) : (event as any).reasonsJson ?? null,
          rulesVersion: (event as any).rulesVersion ?? null,
        });
      }
    }
  }

  // recent events (if model exists)
  let events: any[] = [];
  try {
    events = await prisma.riskEvent.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  } catch {
    events = [];
  }

  const hasRules = rules.length > 0;
  const hasChecks = items.length > 0;
  const toIso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  return {
    shop: session.shop,
    currency,
    tab,
    level,
    lang,
    hasRules,
    hasChecks,
    currentRulesVersion,
    ruleChanges: initialRuleChanges,
    hasMoreRuleChanges,
    rules: rules.map(
      (r): Rule => ({
        id: r.id,
        type: r.type as RuleType,
        operator: r.operator as RuleOp,
        value: r.value,
        points: r.points,
        action: r.action,
        enabled: r.enabled,
        status: r.status as RuleStatus,
        createdAt: r.createdAt.toISOString(),
      }),
    ),

   events: events.map(
  (e): RiskEventRow => {
    const orderId = orderIdFromGid(e.orderGid);
    const orderAdminUrl = orderId ? shopifyAdminOrderUrl(session.shop, orderId) : null;

    const timeIso = e.createdAt ? e.createdAt.toISOString() : null;

    return {
      id: e.id,
      orderGid: e.orderGid,

      // UI обычно ждёт orderName — оставим, но берём из orderNumber
      orderName: (e as any).orderNumber ?? null,

      topic: e.topic,

      // оставляем для совместимости/других мест
      eventAt: timeIso,

      decision: e.decision ?? null,
      skipReason:
        normalizeSkipReason((e as any)?.reasons?.summary ?? null) ??
        normalizeSkipReason((e as any).skipReason) ??
        null,
      orderAdminUrl,
    };
  },
),



    rows: items.map(
      (it): Row => {
        const orderId = orderIdFromGid(it.orderGid);
        const orderAdminUrl = orderId ? shopifyAdminOrderUrl(session.shop, orderId) : null;
        const latestEvent = latestEventsByOrder.get(it.orderGid);
        const reasonsSource = it.reasonsJson ?? latestEvent?.reasonsJson;
        const reasons = reasonsSource ? safeJsonParse(reasonsSource) : [];

        return {
          id: it.id,
          orderGid: it.orderGid,
          orderName: it.orderName,
          score: it.score,
          riskLevel: it.riskLevel as Row["riskLevel"],
          reasons,
          createdAt: it.createdAt.toISOString(),
          updatedAt: it.updatedAt.toISOString(),
          orderAdminUrl,
          rulesVersion: latestEvent?.rulesVersion ?? null,

          // trust (field-safe during migration)
          lastTopic: (it as any).lastTopic ?? null,
          lastEventAt: (it as any).lastEventAt ? (it as any).lastEventAt.toISOString() : null,
          eventCount: Number((it as any).eventCount ?? 0),
          lastRiskChangeAt: (it as any).lastRiskChangeAt ? (it as any).lastRiskChangeAt.toISOString() : null,
          lastDecision: latestEvent?.decision ?? (it as any).lastDecision ?? null,
          skipReason:
            normalizeSkipReason(latestEvent?.skipReason ?? null) ??
            normalizeSkipReason((it as any).skipReason) ??
            null,
        };
      },
    ),
  };
}

function diffRuleChanges(
  before: {
    enabled: boolean;
    operator: string;
    value: string;
    points: number;
    action: string | null;
    status: RuleStatus;
  },
  after: {
    enabled: boolean;
    operator: string;
    value: string;
    points: number;
    action: string | null;
    status: RuleStatus;
  }
) {
  const changes: Array<{ field: string; from: string | null; to: string | null }> = [];

  if (before.enabled !== after.enabled) {
    changes.push({ field: "enabled", from: String(before.enabled), to: String(after.enabled) });
  }

  if (before.operator !== after.operator || before.value !== after.value) {
    changes.push({
      field: "threshold",
      from: `${before.operator} ${before.value}`,
      to: `${after.operator} ${after.value}`,
    });
  }

  if (before.points !== after.points) {
    changes.push({ field: "weight", from: String(before.points), to: String(after.points) });
  }

  if ((before.action ?? "") !== (after.action ?? "")) {
    changes.push({ field: "action", from: before.action, to: after.action });
  }

  if (before.status !== after.status) {
    changes.push({ field: "status", from: before.status, to: after.status });
  }

  return changes;
}

async function recordRuleChange(input: {
  shop: string;
  ruleId: string;
  changedBy: string;
  changedByType: string;
  changes: Array<{ field: string; from: string | null; to: string | null }>;
}) {
  await prisma.riskRuleChange.create({
    data: {
      shop: input.shop,
      ruleId: input.ruleId,
      changedBy: input.changedBy,
      changedByType: input.changedByType,
      changes: input.changes,
    },
  });
}

/* ---------- action ---------- */

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const lang = parseLang(url.searchParams.get("lang"));
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "loadRuleHistory") {
    const cursorChangedAt = String(form.get("cursorChangedAt") ?? "").trim();
    const cursorId = String(form.get("cursorId") ?? "").trim();

    const where =
      cursorChangedAt && cursorId
        ? {
            shop: session.shop,
            OR: [
              { changedAt: { lt: new Date(cursorChangedAt) } },
              { AND: [{ changedAt: new Date(cursorChangedAt) }, { id: { lt: cursorId } }] },
            ],
          }
        : { shop: session.shop };

    const changes = await prisma.riskRuleChange.findMany({
      where,
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
      take: 6,
    });

    const items = changes.slice(0, 5).map((change) => ({
      id: change.id,
      ruleId: change.ruleId,
      changedAt: change.changedAt.toISOString(),
      changedBy: change.changedBy,
      changedByType: change.changedByType,
      changes: Array.isArray(change.changes) ? (change.changes as any) : [],
    }));

    return json<ActionData>({
      ok: true,
      op: "loadRuleHistory",
      items,
      hasMore: changes.length > 5,
    });
  }

  const allowedTypes: RuleType[] = ["ORDER_VALUE", "FIRST_TIME", "HIGH_QTY", "COUNTRY_MISMATCH"];
  const allowedOps: RuleOp[] = [">", ">=", "=", "!=", "<", "<="];
  const allowedStatuses: RuleStatus[] = ["DRAFT", "ACTIVE", "DEPRECATED"];

  const validate = (p: {
    type: string;
    operator: string;
    value: string;
    points: number;
    status: string;
  }): string[] => {
    const errors: string[] = [];
    if (!allowedTypes.includes(p.type as RuleType)) errors.push(t(lang, "errorUnsupportedRuleType"));
    if (!allowedOps.includes(p.operator as RuleOp)) errors.push(t(lang, "errorUnsupportedOperator"));
    if (!p.value) errors.push(t(lang, "errorValueRequired"));
    if (!Number.isFinite(p.points)) errors.push(t(lang, "errorPointsNumber"));
    if (!allowedStatuses.includes(p.status as RuleStatus)) errors.push(t(lang, "errorUnsupportedStatus"));

    if (p.type === "FIRST_TIME") {
      const v = p.value.toLowerCase();
      if (v !== "true" && v !== "false") errors.push(t(lang, "errorFirstTimeBool"));
    }
    return errors;
  };

  // seed defaults (only if no rules)
  if (intent === "seedDefaultRules") {
    const existingCount = await prisma.riskRule.count({ where: { shop: session.shop } });
    if (existingCount > 0) {
      return json<ActionData>({ ok: false, error: t(lang, "errorDefaultsOnlyNoRules") }, 400);
    }

    const defaults: Array<{
      type: RuleType;
      operator: RuleOp;
      value: string;
      points: number;
      action: string | null;
      enabled: boolean;
    }> = [
        { type: "ORDER_VALUE", operator: ">=", value: "300", points: 15, action: "REVIEW", enabled: true },
        { type: "ORDER_VALUE", operator: ">=", value: "500", points: 25, action: "HOLD", enabled: true },

        { type: "FIRST_TIME", operator: "=", value: "true", points: 10, action: "REVIEW", enabled: true },

        { type: "HIGH_QTY", operator: ">=", value: "5", points: 10, action: "REVIEW", enabled: true },
        { type: "HIGH_QTY", operator: ">=", value: "10", points: 20, action: "HOLD", enabled: true },

        { type: "COUNTRY_MISMATCH", operator: "=", value: "true", points: 15, action: "HOLD", enabled: true },
      ];

    const created = await prisma.$transaction(
      defaults.map((d) =>
        prisma.riskRule.create({
          data: {
            shop: session.shop,
            type: d.type,
            operator: d.operator,
            value: d.value,
            points: Math.trunc(d.points),
            action: d.action,
            enabled: d.enabled,
          },
        }),
      ),
    );

    const rules: Rule[] = created
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        id: r.id,
        type: r.type as RuleType,
        operator: r.operator as RuleOp,
        value: r.value,
        points: r.points,
        action: r.action,
        enabled: r.enabled,
        status: r.status as RuleStatus,
        createdAt: r.createdAt.toISOString(),
      }));

    return json<ActionData>({ ok: true, op: "seedDefaults", rules });
  }

  if (intent === "addRule") {
    const type = String(form.get("type") ?? "").trim();
    const operator = String(form.get("operator") ?? "").trim();
    const value = String(form.get("value") ?? "").trim();
    const pointsRaw = String(form.get("points") ?? "").trim();
    const actionValue = String(form.get("action") ?? "").trim();
    const points = Number(pointsRaw);

    const status = String(form.get("status") ?? "ACTIVE").trim();
    const errors = validate({ type, operator, value, points, status });
    if (errors.length) return json<ActionData>({ ok: false, error: errors.join("; ") }, 400);

    const created = await prisma.riskRule.create({
      data: {
        shop: session.shop,
        type,
        operator,
        value,
        points: Math.trunc(points),
        action: actionValue ? actionValue : null,
        status: status as RuleStatus,
        enabled: true,
      },
    });

    await recordRuleChange({
      shop: session.shop,
      ruleId: created.id,
      changedBy: session.shop,
      changedByType: "SHOP",
      changes: [{ field: "created", from: null, to: "true" }],
    });

    return json<ActionData>({
      ok: true,
      op: "addRule",
      rule: {
        id: created.id,
        type: created.type as RuleType,
        operator: created.operator as RuleOp,
        value: created.value,
        points: created.points,
        action: created.action,
        enabled: created.enabled,
        status: created.status as RuleStatus,
        createdAt: created.createdAt.toISOString(),
      },
    });
  }

  if (intent === "updateRule") {
    const id = String(form.get("id") ?? "").trim();
    const type = String(form.get("type") ?? "").trim();
    const operator = String(form.get("operator") ?? "").trim();
    const value = String(form.get("value") ?? "").trim();
    const pointsRaw = String(form.get("points") ?? "").trim();
    const actionValue = String(form.get("action") ?? "").trim();
    const status = String(form.get("status") ?? "ACTIVE").trim();

    if (!id) return json<ActionData>({ ok: false, error: t(lang, "errorMissingId") }, 400);

    const exists = await prisma.riskRule.findFirst({ where: { id, shop: session.shop } });
    if (!exists) return json<ActionData>({ ok: false, error: t(lang, "errorRuleNotFound") }, 404);

    const points = Number(pointsRaw);
    const errors = validate({ type, operator, value, points, status });
    if (errors.length) return json<ActionData>({ ok: false, error: errors.join("; ") }, 400);

    const changes = diffRuleChanges(exists, {
      type,
      operator,
      value,
      points: Math.trunc(points),
      action: actionValue ? actionValue : null,
      enabled: exists.enabled,
      status: status as RuleStatus,
    });

    await prisma.riskRule.update({
      where: { id },
      data: {
        type,
        operator,
        value,
        points: Math.trunc(points),
        action: actionValue ? actionValue : null,
        status: status as RuleStatus,
      },
    });

    if (changes.length > 0) {
      await recordRuleChange({
        shop: session.shop,
        ruleId: id,
        changedBy: session.shop,
        changedByType: "SHOP",
        changes,
      });
    }

    return json<ActionData>({ ok: true, op: "updateRule", id });
  }

  if (intent === "toggleRule") {
    const id = String(form.get("id") ?? "").trim();
    const enabled = String(form.get("enabled") ?? "") === "true";
    if (!id) return json<ActionData>({ ok: false, error: t(lang, "errorMissingRuleId") }, 400);

    const rule = await prisma.riskRule.findFirst({ where: { id, shop: session.shop } });
    if (!rule) return json<ActionData>({ ok: false, error: t(lang, "errorRuleNotFound") }, 404);

    await prisma.riskRule.update({ where: { id }, data: { enabled } });
    if (rule.enabled !== enabled) {
      await recordRuleChange({
        shop: session.shop,
        ruleId: id,
        changedBy: session.shop,
        changedByType: "SHOP",
        changes: [
          {
            field: "enabled",
            from: String(rule.enabled),
            to: String(enabled),
          },
        ],
      });
    }
    return json<ActionData>({ ok: true, op: "toggleRule", id, enabled });
  }

  if (intent === "deleteRule") {
    const id = String(form.get("id") ?? "").trim();
    if (!id) return json<ActionData>({ ok: false, error: t(lang, "errorMissingRuleId") }, 400);

    const rule = await prisma.riskRule.findFirst({ where: { id, shop: session.shop } });
    if (!rule) return json<ActionData>({ ok: false, error: t(lang, "errorRuleNotFound") }, 404);

    await recordRuleChange({
      shop: session.shop,
      ruleId: id,
      changedBy: session.shop,
      changedByType: "SHOP",
      changes: [{ field: "deleted", from: "false", to: "true" }],
    });
    await prisma.riskRule.delete({ where: { id } });
    return json<ActionData>({ ok: true, op: "deleteRule", id });
  }

  return json<ActionData>({ ok: false, error: t(lang, "errorUnknownAction") }, 400);
}

/* ---------- component ---------- */

export default function AppIndex() {
  const data = useLoaderData() as LoaderData;
  const [params, setParams] = useSearchParams();

  const lang = (params.get("lang") ? parseLang(params.get("lang")) : data.lang) as Lang;

  const tab = (params.get("tab") ?? "orders").toLowerCase();
  const level = (params.get("level") ?? "ALL").toUpperCase();
  const focusedRuleId = params.get("ruleId");
  const [openFactorId, setOpenFactorId] = useState<string | null>(null);

  type Tab = "orders" | "rules" | "events";

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p);
  };

  const setLevel = (lvl: string) => {
    const p = new URLSearchParams(params);
    if (lvl === "ALL") p.delete("level");
    else p.set("level", lvl);
    setParams(p);
  };

  const setLang = (next: Lang) => {
    const p = new URLSearchParams(params);
    p.set("lang", next);
    setParams(p);
  };

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <div style={kicker}>{t(lang, "appName")}</div>
          <div style={subtle}>
            {data.shop} · {t(lang, "storeCurrency")}: <b>{data.currency}</b>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={langSelect}>
            {SUPPORTED_LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div style={tabsWrap}>
        <button type="button" onClick={() => setTab("orders")} style={tabBtn(tab === "orders")}>
          {t(lang, "tabOrders")}
        </button>
        <button type="button" onClick={() => setTab("rules")} style={tabBtn(tab === "rules")}>
          {t(lang, "tabRules")}
        </button>
        <button type="button" onClick={() => setTab("events")} style={tabBtn(tab === "events")}>
          {t(lang, "tabEvents")}
        </button>
      </div>

      {tab === "orders" ? (
        <>
          <SetupChecklist lang={lang} hasRules={data.hasRules} hasChecks={data.hasChecks} shop={data.shop} />
          <div style={{ height: 12 }} />

          {/* ✅ ВАЖНО: Recent events БОЛЬШЕ НЕ показываем в Orders */}

          <section style={card}>
            <div style={cardHeaderRow}>
              <h2 style={h2}>{t(lang, "ordersTitle")}</h2>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setLevel("ALL")} style={pillBtn(level === "ALL")}>
                  {t(lang, "all")}
                </button>
                <button onClick={() => setLevel("HIGH")} style={pillBtn(level === "HIGH")}>
                  {t(lang, "high")}
                </button>
                <button onClick={() => setLevel("MEDIUM")} style={pillBtn(level === "MEDIUM")}>
                  {t(lang, "medium")}
                </button>
                <button onClick={() => setLevel("LOW")} style={pillBtn(level === "LOW")}>
                  {t(lang, "low")}
                </button>
              </div>
            </div>

            <div style={divider} />

            {data.rows.length === 0 ? (
              <EmptyState title={t(lang, "noChecksYetTitle")}>{t(lang, "noChecksYetText")}</EmptyState>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableOrders}>
                  <thead>
                    <tr>
                      <th style={th}>{t(lang, "thLastEvent")}</th>
                      <th style={th}>{t(lang, "thUpdated")}</th>
                      <th style={th}>{t(lang, "thOrder")}</th>
                      <th style={th}>{t(lang, "thScore")}</th>
                      <th style={th}>{t(lang, "thRisk")}</th>
                      <th style={th}>{t(lang, "thTopReasons")}</th>
                      <th style={th}>{t(lang, "thLink")}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td style={td}>
                          <div>{formatDate(r.lastEventAt ?? r.updatedAt)}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6d7175" }}>
                            <code style={codeInline}>{r.lastTopic ?? "—"}</code>
                            <span style={{ marginLeft: 8 }}>×{r.eventCount ?? 0}</span>
                          </div>

                          {/* ✅ mini “trust” lines */}
                          <div style={{ marginTop: 6, fontSize: 12, color: "#6d7175" }}>
                            {t(lang, "riskChanged")}: {formatDate(r.lastRiskChangeAt)}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 12, color: "#6d7175" }}>
                            {t(lang, "decision")}:{" "}
                            <DecisionDisplay
                              decision={r.lastDecision}
                              skipReason={r.skipReason}
                              lang={lang}
                            />
                          </div>
                          <div style={{ marginTop: 2, fontSize: 12, color: "#6d7175" }}>
                            {t(lang, "rulesVersionLabel")}:{" "}
                            {r.rulesVersion ? (
                              <code style={codeInline} title={r.rulesVersion}>
                                {shortRulesVersion(r.rulesVersion)}
                              </code>
                            ) : (
                              <span style={subtle}>—</span>
                            )}
                          </div>
                        </td>

                        <td style={td}>{formatDate(r.updatedAt)}</td>

                        <td style={tdStrong}>
                          {r.orderName}
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6d7175" }}>
                            <code style={codeInline}>{shortGid(r.orderGid)}</code>
                          </div>
                        </td>

                        <td style={td}>{r.score}</td>

                        <td style={td}>
                          <span style={riskPill(r.riskLevel)}>{riskLevelLabel(lang, r.riskLevel)}</span>
                        </td>

                        <td style={td}>
                          {Array.isArray(r.reasons) && r.reasons.length ? (
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {r.reasons.slice(0, 3).map((x: any, i: number) => {
                                const label = formatReasonLabel(x, lang);
                                const ruleKey = reasonRuleKey(x);
                                const factorId = `${r.id}:${i}`;
                                const lines = factorPopoverLines(x, lang);
                                return (
                                  <li key={i} style={{ position: "relative" }}>
                                    <span
                                      style={popoverTrigger}
                                      tabIndex={0}
                                      onClick={() =>
                                        setOpenFactorId(openFactorId === factorId ? null : factorId)
                                      }
                                      onBlur={() => {
                                        window.setTimeout(() => setOpenFactorId(null), 0);
                                      }}
                                    >
                                      <code style={codeInline}>{label}</code>
                                    </span>
                                    {openFactorId === factorId && ruleKey ? (
                                      <div style={popoverCard}>
                                        {lines.map((line) => (
                                          <div key={line} style={popoverLine}>
                                            {line}
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </li>
                                );
                              })}
                              {r.reasons.length > 3 ? <li>…</li> : null}
                            </ul>
                          ) : (
                            <span style={subtle}>—</span>
                          )}
                        </td>

                        <td style={td}>
                          {r.orderAdminUrl ? (
                            <a href={r.orderAdminUrl} target="_blank" rel="noreferrer" style={link}>
                              {t(lang, "open")}
                            </a>
                          ) : (
                            <span style={subtle}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : tab === "rules" ? (
        <RulesInline data={data} lang={lang} focusedRuleId={focusedRuleId} />
      ) : (
        <EventsTab data={data} lang={lang} />
      )}
    </div>
  );
}

/* ---------- Rules inline editor ---------- */

function RulesInline({
  data,
  lang,
  focusedRuleId,
}: {
  data: LoaderData;
  lang: Lang;
  focusedRuleId: string | null;
}) {
  const [localRules, setLocalRules] = useState<Rule[]>(data.rules);
  useEffect(() => setLocalRules(data.rules), [data.rules]);

  const addFetcher = useFetcher<ActionData>();
  const seedFetcher = useFetcher<ActionData>();
  const saveFetcher = useFetcher<ActionData>();
  const mutateFetcher = useFetcher<ActionData>();

  const addFormRef = useRef<HTMLFormElement | null>(null);

  const timersRef = useRef<Record<string, number>>({});
  const lastPayloadRef = useRef<Record<string, string>>({});

  const allowedTypes: RuleType[] = ["ORDER_VALUE", "FIRST_TIME", "HIGH_QTY", "COUNTRY_MISMATCH"];
  const allowedOps: RuleOp[] = [">", ">=", "=", "!=", "<", "<="];
  const allowedStatuses: RuleStatus[] = ["DRAFT", "ACTIVE", "DEPRECATED"];

  const [newRuleType, setNewRuleType] = useState<RuleType>("ORDER_VALUE");
  const [newRuleStatus, setNewRuleStatus] = useState<RuleStatus>("ACTIVE");
  const [ruleHistory, setRuleHistory] = useState<RuleChange[]>(data.ruleChanges ?? []);
  const [hasMoreHistory, setHasMoreHistory] = useState<boolean>(Boolean(data.hasMoreRuleChanges));
  const historyFetcher = useFetcher<ActionData>();

  useEffect(() => {
    if (!focusedRuleId) return;
    const el = document.getElementById(`rule-${focusedRuleId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedRuleId, localRules]);

  const [ui, setUi] = useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({ state: "idle" });

  const statusLabel = useMemo(() => {
    if (ui.state === "saving") return { text: t(lang, "saving"), style: statusPill("saving") };
    if (ui.state === "saved") return { text: t(lang, "saved"), style: statusPill("saved") };
    if (ui.state === "error")
      return { text: ui.msg ? `${t(lang, "error")}: ${ui.msg}` : t(lang, "error"), style: statusPill("error") };
    return { text: t(lang, "idleDash"), style: statusPill("idle") };
  }, [ui, lang]);

  useEffect(() => {
    if (saveFetcher.state === "submitting") setUi({ state: "saving" });
    if (saveFetcher.state === "idle" && saveFetcher.data) {
      const d = saveFetcher.data;
      if (d.ok) {
        setUi({ state: "saved" });
        window.setTimeout(() => setUi((s) => (s.state === "saved" ? { state: "idle" } : s)), 1200);
      } else {
        setUi({ state: "error", msg: d.error });
      }
    }
  }, [saveFetcher.state, saveFetcher.data]);

  useEffect(() => {
    const d = addFetcher.data;
    if (!d || !d.ok || d.op !== "addRule") return;
    setLocalRules((prev) => [d.rule, ...prev]);
    addFormRef.current?.reset();
    setNewRuleType("ORDER_VALUE");
    setNewRuleStatus("ACTIVE");
    setUi({ state: "saved" });
    window.setTimeout(() => setUi((s) => (s.state === "saved" ? { state: "idle" } : s)), 900);
  }, [addFetcher.data]);

  useEffect(() => {
    const d = seedFetcher.data;
    if (!d || !d.ok || d.op !== "seedDefaults") return;
    setLocalRules(d.rules);
    setUi({ state: "saved" });
    window.setTimeout(() => setUi((s) => (s.state === "saved" ? { state: "idle" } : s)), 900);
  }, [seedFetcher.data]);

  useEffect(() => {
    const d = mutateFetcher.data;
    if (!d || !d.ok) return;

    if (d.op === "toggleRule") {
      setLocalRules((prev) => prev.map((r) => (r.id === d.id ? { ...r, enabled: d.enabled } : r)));
      return;
    }
    if (d.op === "deleteRule") {
      setLocalRules((prev) => prev.filter((r) => r.id !== d.id));
      return;
    }
  }, [mutateFetcher.data]);

  useEffect(() => {
    const d = historyFetcher.data;
    if (!d || !d.ok || d.op !== "loadRuleHistory") return;
    if (d.items?.length) {
      setRuleHistory((prev) => [...prev, ...d.items]);
    }
    setHasMoreHistory(Boolean(d.hasMore));
  }, [historyFetcher.data]);

  function submitUpdate(rule: Rule) {
    const payloadKey = JSON.stringify({
      id: rule.id,
      type: rule.type,
      operator: rule.operator,
      value: rule.value,
      points: rule.points,
      action: rule.action ?? "",
      status: rule.status,
    });

    if (lastPayloadRef.current[rule.id] === payloadKey) return;
    lastPayloadRef.current[rule.id] = payloadKey;

    const fd = new FormData();
    fd.set("_action", "updateRule");
    fd.set("id", rule.id);
    fd.set("type", rule.type);
    fd.set("operator", rule.operator);
    fd.set("value", rule.value);
    fd.set("points", String(rule.points));
    fd.set("action", rule.action ?? "");
    fd.set("status", rule.status);

    saveFetcher.submit(fd, { method: "post", action: "?index" });
  }

  function scheduleSave(rule: Rule, immediate = false) {
    const id = rule.id;
    const existing = timersRef.current[id];
    if (existing) window.clearTimeout(existing);

    if (immediate) {
      submitUpdate(rule);
      return;
    }

    timersRef.current[id] = window.setTimeout(() => submitUpdate(rule), 700);
  }

  function updateRuleLocal(id: string, patch: Partial<Rule>, saveMode: "debounce" | "blur" = "debounce") {
    setLocalRules((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const updated = next.find((x) => x.id === id);
      if (updated) scheduleSave(updated, saveMode === "blur");
      return next;
    });
  }

  function toggleRule(id: string, enabled: boolean) {
    const fd = new FormData();
    fd.set("_action", "toggleRule");
    fd.set("id", id);
    fd.set("enabled", String(enabled));
    mutateFetcher.submit(fd, { method: "post", action: "?index" });
  }

  function deleteRule(id: string) {
    if (!confirm(t(lang, "deleteConfirm"))) return;
    const fd = new FormData();
    fd.set("_action", "deleteRule");
    fd.set("id", id);
    mutateFetcher.submit(fd, { method: "post", action: "?index" });
  }

  return (
    <section style={card}>
      <div style={cardHeaderRow}>
        <div>
          <h2 style={h2}>{t(lang, "rulesTitle")}</h2>
          <div style={subtle}>
            {t(lang, "rulesSubtitle")} <b>{data.currency}</b>
          </div>
          <div style={{ ...subtle, marginTop: 6 }}>
            {t(lang, "rulesVersionLabel")}:{" "}
            <code style={codeInline} title={data.currentRulesVersion}>
              {shortRulesVersion(data.currentRulesVersion)}
            </code>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={statusLabel.style}>{statusLabel.text}</span>
        </div>
      </div>

      <div style={divider} />

      {localRules.length === 0 ? (
        <>
          <EmptyState title={t(lang, "noChecksYetTitle")}>{t(lang, "noRulesYetText")}</EmptyState>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <seedFetcher.Form method="post" action="?index">
              <input type="hidden" name="_action" value="seedDefaultRules" />
              <button type="submit" style={primaryBtn} disabled={seedFetcher.state !== "idle"}>
                {seedFetcher.state === "submitting" ? t(lang, "addingDefaults") : t(lang, "addDefaultRules")}
              </button>
            </seedFetcher.Form>

            {seedFetcher.data && !seedFetcher.data.ok ? (
              <div style={{ fontSize: 13, color: "#8a2a0a" }}>
                {t(lang, "error")}: {seedFetcher.data.error}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableRules}>
            <colgroup>
              <col style={{ width: 86 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 240 }} />
              <col style={{ width: 150 }} />
            </colgroup>

            <thead>
              <tr>
                <th style={th}>{t(lang, "enabled")}</th>
                <th style={th}>{t(lang, "status")}</th>
                <th style={th}>{t(lang, "type")}</th>
                <th style={th}>{t(lang, "threshold")}</th>
                <th style={th}>{t(lang, "points")}</th>
                <th style={th}>{t(lang, "action")}</th>
                <th style={th}></th>
              </tr>
            </thead>

            <tbody>
              {localRules.map((r) => (
                <tr key={r.id} id={`rule-${r.id}`} style={focusedRuleId === r.id ? ruleFocusRow : undefined}>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => toggleRule(r.id, !r.enabled)}
                      style={toggleBtn(r.enabled)}
                      disabled={mutateFetcher.state !== "idle"}
                    >
                      {r.enabled ? t(lang, "on") : t(lang, "off")}
                    </button>
                  </td>

                  <td style={td}>
                    <select
                      value={r.status}
                      style={cellControl}
                      onChange={(e) => updateRuleLocal(r.id, { status: e.target.value as RuleStatus })}
                      onBlur={() => scheduleSave(r, true)}
                    >
                      {allowedStatuses.map((st) => (
                        <option key={st} value={st}>
                          {ruleStatusLabel(lang, st)}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={td}>
                    <select
                      value={r.type}
                      style={cellControl}
                      title={ruleTypeDescription(lang, r.type) || ruleTypeLabel(lang, r.type)}
                      onChange={(e) => updateRuleLocal(r.id, { type: e.target.value as RuleType })}
                      onBlur={() => scheduleSave(r, true)}
                    >
                      {allowedTypes.map((tt) => (
                        <option key={tt} value={tt}>
                          {ruleTypeLabel(lang, tt)}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={td}>
                    <div style={cellGroup}>
                      <select
                        value={r.operator}
                        style={cellControlCompact}
                        onChange={(e) => updateRuleLocal(r.id, { operator: e.target.value as RuleOp })}
                        onBlur={() => scheduleSave(r, true)}
                      >
                        {allowedOps.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <input
                        value={r.value}
                        style={cellControl}
                        onChange={(e) => updateRuleLocal(r.id, { value: e.target.value })}
                        onBlur={() => scheduleSave(r, true)}
                      />
                    </div>
                  </td>

                  <td style={td}>
                    <input
                      value={String(r.points)}
                      style={cellControlNarrow}
                      inputMode="numeric"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        updateRuleLocal(r.id, { points: Number.isFinite(n) ? Math.trunc(n) : 0 });
                      }}
                      onBlur={() => scheduleSave(r, true)}
                    />
                  </td>

                  <td style={td}>
                      <input
                        value={r.action ?? ""}
                        placeholder={t(lang, "actionPlaceholderInline")}
                      style={cellControl}
                      onChange={(e) => updateRuleLocal(r.id, { action: e.target.value || null })}
                      onBlur={() => scheduleSave(r, true)}
                    />
                  </td>

                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => deleteRule(r.id)}
                      style={dangerBtn}
                      disabled={mutateFetcher.state !== "idle"}
                    >
                      {t(lang, "delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ height: 16 }} />
      <section style={cardInner}>
        <h3 style={h3}>{t(lang, "addRuleTitle")}</h3>

        <addFetcher.Form ref={addFormRef} method="post" action="?index" style={formGrid}>
          <input type="hidden" name="_action" value="addRule" />

        <label style={field}>
          <span style={label}>{t(lang, "type")}</span>
          <select
            name="type"
            value={newRuleType}
            style={control}
            title={ruleTypeDescription(lang, newRuleType) || ruleTypeLabel(lang, newRuleType)}
            onChange={(e) => setNewRuleType(e.target.value as RuleType)}
          >
            {allowedTypes.map((tt) => (
              <option key={tt} value={tt}>
                {ruleTypeLabel(lang, tt)}
              </option>
            ))}
          </select>
          {ruleTypeDescription(lang, newRuleType) ? (
            <div style={{ ...subtle, marginTop: 6 }}>{ruleTypeDescription(lang, newRuleType)}</div>
          ) : null}
        </label>

        <label style={field}>
          <span style={label}>{t(lang, "operator")}</span>
          <select name="operator" defaultValue=">" style={control}>
            <option value=">">{">"}</option>
            <option value=">=">{">="}</option>
            <option value="=">{"="}</option>
            <option value="!=">{"!="}</option>
            <option value="<">{"<"}</option>
            <option value="<=">{"<="}</option>
          </select>
        </label>

        <label style={field}>
          <span style={label}>{t(lang, "value")}</span>
          <input name="value" placeholder={t(lang, "valuePlaceholder")} style={control} />
        </label>

        <label style={field}>
          <span style={label}>{t(lang, "points")}</span>
          <input name="points" placeholder={t(lang, "pointsPlaceholder")} defaultValue="15" style={control} />
        </label>

        <label style={field}>
          <span style={label}>{t(lang, "status")}</span>
          <select
            name="status"
            value={newRuleStatus}
            style={control}
            onChange={(e) => setNewRuleStatus(e.target.value as RuleStatus)}
          >
            {allowedStatuses.map((st) => (
              <option key={st} value={st}>
                {ruleStatusLabel(lang, st)}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          <span style={label}>{t(lang, "action")}</span>
          <input name="action" placeholder={t(lang, "actionPlaceholderAdd")} style={control} />
        </label>

          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="submit" style={primaryBtn} disabled={addFetcher.state !== "idle"}>
              {addFetcher.state === "submitting" ? t(lang, "addingRule") : t(lang, "addRuleBtn")}
            </button>
          </div>
        </addFetcher.Form>

      {addFetcher.data && !addFetcher.data.ok ? (
        <div style={{ marginTop: 10, fontSize: 13, color: "#8a2a0a" }}>
          {t(lang, "error")}: {addFetcher.data.error}
        </div>
      ) : null}

        <div style={{ marginTop: 10, fontSize: 13, color: "#6d7175" }}>
          {t(lang, "examples")}:{" "}
          <code style={codeInline}>{`${ruleTypeLabel(lang, "FIRST_TIME")} = true`}</code>,{" "}
          <code style={codeInline}>{`${ruleTypeLabel(lang, "ORDER_VALUE")} > 300`}</code>,{" "}
          <code style={codeInline}>REVIEW</code>.
        </div>
      </section>

      <div style={{ height: 16 }} />
      <section style={cardInner}>
        <div style={cardHeaderRow}>
          <div>
            <h3 style={h3}>{t(lang, "recentChangesTitle")}</h3>
            <div style={subtle}>{t(lang, "recentChangesSubtitle")}</div>
          </div>
        </div>
        <div style={divider} />
        {ruleHistory.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {ruleHistory.map((h) => (
              <li key={h.id}>
                <code style={codeInline}>{formatDate(h.changedAt)}</code> {t(lang, "by")} {h.changedBy}:{" "}
                {formatRuleChangeSummary(h, lang)}
              </li>
            ))}
          </ul>
        ) : (
          <span style={subtle}>{t(lang, "noHistory")}</span>
        )}
        {hasMoreHistory ? (
          <div style={{ marginTop: 10 }}>
            <historyFetcher.Form method="post" action="?index">
              <input type="hidden" name="_action" value="loadRuleHistory" />
              <input type="hidden" name="cursorChangedAt" value={ruleHistory.at(-1)?.changedAt ?? ""} />
              <input type="hidden" name="cursorId" value={ruleHistory.at(-1)?.id ?? ""} />
              <button type="submit" style={secondaryBtn} disabled={historyFetcher.state !== "idle"}>
                {historyFetcher.state === "submitting" ? t(lang, "loading") : t(lang, "loadMore")}
              </button>
            </historyFetcher.Form>
          </div>
        ) : null}
      </section>
    </section>
  );
}

/* ---------- Events tab (✅ теперь тут Recent events блок) ---------- */

function EventsTab({ data, lang }: { data: LoaderData; lang: Lang }) {
  return (
    <section style={card}>
      <div style={cardHeaderRow}>
        <div>
          <h2 style={h2}>{t(lang, "recentEventsTitle")}</h2>
          <div style={subtle}>{t(lang, "recentEventsSubtitle")}</div>
        </div>
      </div>

      <div style={divider} />

      {!data.events || data.events.length === 0 ? (
        <EmptyState title={t(lang, "noChecksYetTitle")}>{t(lang, "noEventsYet")}</EmptyState>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableOrders}>
            <thead>
              <tr>
                <th style={th}>{t(lang, "evTime")}</th>
                <th style={th}>{t(lang, "evTopic")}</th>
                <th style={th}>{t(lang, "evOrder")}</th>
                <th style={th}>{t(lang, "evDecision")}</th>
                <th style={th}>{t(lang, "thLink")}</th>
              </tr>
            </thead>

            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{formatDate(e.eventAt)}</td>

                  <td style={td}>
                    <code style={codeInline}>{e.topic}</code>
                  </td>

                  <td style={tdStrong}>
                    {e.orderName || "—"}
                    <div style={{ marginTop: 4, fontSize: 12, color: "#6d7175" }}>
                      <code style={codeInline}>{shortGid(e.orderGid)}</code>
                    </div>
                  </td>

                  <td style={td}>
                    <DecisionDisplay decision={e.decision} skipReason={e.skipReason} lang={lang} />
                  </td>

                  <td style={td}>
                    {e.orderAdminUrl ? (
                      <a href={e.orderAdminUrl} target="_blank" rel="noreferrer" style={link}>
                        {t(lang, "open")}
                      </a>
                    ) : (
                      <span style={subtle}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- Setup checklist ---------- */

function SetupChecklist({
  lang,
  hasRules,
  hasChecks,
  shop,
}: {
  lang: Lang;
  hasRules: boolean;
  hasChecks: boolean;
  shop: string;
}) {
  const done = hasRules && hasChecks;
  if (done) return null;

  const storeHandle = shop.replace(".myshopify.com", "");

  return (
    <section style={checkCard}>
      <div style={checkHeader}>
        <div>
          <div style={{ fontWeight: 800 }}>{t(lang, "setupChecklistTitle")}</div>
          <div style={{ color: "#6d7175", fontSize: 13 }}>{t(lang, "setupChecklistSubtitle")}</div>
        </div>
        <span style={pillMini("warn")}>{t(lang, "setup")}</span>
      </div>

      <div style={{ height: 10 }} />

      <div style={checkList}>
        <CheckItem
          done={hasRules}
          title={t(lang, "createRulesTitle")}
          desc={hasRules ? t(lang, "createRulesDone") : t(lang, "createRulesTodo")}
        />

        <CheckItem
          done={hasChecks}
          title={t(lang, "receiveWebhooksTitle")}
          desc={hasChecks ? t(lang, "receiveWebhooksDone") : t(lang, "receiveWebhooksTodo")}
          extra={
            !hasChecks ? (
              <div style={{ marginTop: 6, fontSize: 13, color: "#202223" }}>
                {t(lang, "quickLink")}:{" "}
                <a
                  href={`https://admin.shopify.com/store/${storeHandle}/orders`}
                  target="_blank"
                  rel="noreferrer"
                  style={link}
                >
                  {t(lang, "openOrdersInAdmin")}
                </a>
              </div>
            ) : null
          }
        />
      </div>
    </section>
  );
}

function CheckItem({
  done,
  title,
  desc,
  extra,
}: {
  done: boolean;
  title: string;
  desc: string;
  extra?: React.ReactNode;
}) {
  return (
    <div style={checkItem}>
      <div style={checkIcon(done)}>{done ? "✓" : "•"}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{title}</div>
        <div style={{ color: "#6d7175", fontSize: 13 }}>{desc}</div>
        {extra}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function json<T>(obj: T, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeJsonParse(s: string) {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && Array.isArray((v as any).factors)) return (v as any).factors;
    return [];
  } catch {
    return [];
  }
}

function normalizeSkipReason(raw: unknown) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === "UNCHANGED" || upper === "OUT_OF_ORDER" || upper === "NO_RULES") return upper;
  const lower = s.toLowerCase();
  if (lower.includes("unchanged")) return "UNCHANGED";
  if (lower.includes("out of order")) return "OUT_OF_ORDER";
  if (lower.includes("no rules")) return "NO_RULES";
  if (/^skipped\b/i.test(s)) return s;
  return null;
}

function extractReasonsArray(reasons: any) {
  if (!reasons || typeof reasons !== "object") return null;
  if (Array.isArray(reasons)) return reasons;
  if (Array.isArray((reasons as any).factors)) {
    return (reasons as any).factors;
  }
  return null;
}

function ruleTypeLabel(lang: Lang, type: RuleType) {
  const key = `ruleType_${type}`;
  const value = t(lang, key);
  return value === key ? type : value;
}

function ruleTypeDescription(lang: Lang, type: RuleType) {
  const key = `ruleType_${type}_desc`;
  const value = t(lang, key);
  return value === key ? "" : value;
}

function ruleStatusLabel(lang: Lang, status: RuleStatus) {
  const key = `ruleStatus_${status}`;
  const value = t(lang, key);
  return value === key ? status : value;
}

function formatReasonLabel(reason: any, lang: Lang) {
  if (typeof reason === "string") return ruleTypeLabel(lang, reason as RuleType);
  if (reason && typeof reason === "object" && typeof reason.label === "string") {
    return ruleTypeLabel(lang, reason.label as RuleType);
  }
  if (reason && typeof reason === "object" && typeof reason.code === "string") {
    return ruleTypeLabel(lang, reason.code as RuleType);
  }
  return t(lang, "reasonFallback");
}

function reasonRuleKey(reason: any) {
  if (reason && typeof reason === "object" && typeof reason.ruleKey === "string") {
    if (reason.ruleKey.startsWith("legacy:")) return null;
    return reason.ruleKey;
  }
  return null;
}

function factorRuleInfo(reason: any) {
  if (!reason || typeof reason !== "object") return null;
  const ruleKey = reasonRuleKey(reason);
  if (!ruleKey) return null;
  return {
    ruleKey,
    ruleType: typeof reason.ruleType === "string" ? reason.ruleType : "",
    operator: typeof reason.operator === "string" ? reason.operator : "",
    value: typeof reason.value === "string" ? reason.value : "",
    weight: Number.isFinite(reason.weight) ? String(reason.weight) : "",
    action: typeof reason.action === "string" ? reason.action : "",
    status: typeof reason.status === "string" ? reason.status : "",
  };
}

function factorPopoverLines(reason: any, lang: Lang) {
  const info = factorRuleInfo(reason);
  if (!info) return [];
  const threshold = info.operator && info.value ? `${info.operator} ${info.value}` : t(lang, "emptyValue");
  const status = info.status ? ruleStatusLabel(lang, info.status as RuleStatus) : t(lang, "emptyValue");
  const action = info.action ? info.action : t(lang, "emptyValue");
  const typeLabel = info.ruleType ? ruleTypeLabel(lang, info.ruleType as RuleType) : t(lang, "emptyValue");
  return [
    `${t(lang, "ruleLabel")}: ${info.ruleKey}`,
    `${t(lang, "type")}: ${typeLabel}`,
    `${t(lang, "status")}: ${status}`,
    `${t(lang, "threshold")}: ${threshold}`,
    `${t(lang, "points")}: ${info.weight || t(lang, "emptyValue")}`,
    `${t(lang, "action")}: ${action}`,
  ];
}

function riskLevelLabel(lang: Lang, level: Row["riskLevel"]) {
  const key = level.toLowerCase();
  return t(lang, key);
}

function decisionLabel(lang: Lang, decision: string) {
  const upper = decision.toUpperCase();
  if (upper === "ALLOW") return t(lang, "decisionAllow");
  if (upper === "REVIEW") return t(lang, "decisionReview");
  if (upper === "HOLD") return t(lang, "decisionHold");
  return decision;
}

function formatRuleChangeSummary(entry: RuleChange, lang: Lang) {
  if (!entry.changes.length) return t(lang, "noChangeDetails");

  const created = entry.changes.find((c) => c.field === "created");
  if (created) {
    return `${t(lang, "change_created")} ${t(lang, "change_rule")}`;
  }

  const deleted = entry.changes.find((c) => c.field === "deleted");
  if (deleted) {
    return `${t(lang, "change_deleted")} ${t(lang, "change_rule")}`;
  }

  const parts = entry.changes.map((change) => {
    const fieldLabel = t(lang, `change_${change.field}`);
    const from = formatChangeValue(change.from, lang);
    const to = formatChangeValue(change.to, lang);
    return `${fieldLabel}: ${from} → ${to}`;
  });
  return parts.join("; ");
}

function formatChangeValue(value: string | null, lang: Lang) {
  if (value === null || value === "") return t(lang, "emptyValue");
  return value;
}

function orderIdFromGid(gid: string) {
  const m = gid.match(/\/Order\/(\d+)$/);
  return m?.[1] ?? null;
}

function shopifyAdminOrderUrl(shopMyshopify: string, orderId: string) {
  const storeHandle = shopMyshopify.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/orders/${orderId}`;
}

function shortGid(gid: string) {
  const orderId = orderIdFromGid(gid);
  return orderId ? `Order/${orderId}` : gid;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function shortRulesVersion(version: string) {
  return version.length > 8 ? version.slice(0, 8) : version;
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={empty}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "#6d7175" }}>{children}</div>
    </div>
  );
}

function skipTooltip(skipReason: string, lang: Lang) {
  if (skipReason === "UNCHANGED") {
    return t(lang, "skippedTooltipUnchanged");
  }
  if (skipReason === "OUT_OF_ORDER") {
    return t(lang, "skippedTooltipOutOfOrder");
  }
  if (skipReason === "NO_RULES") {
    return t(lang, "skippedTooltipNoRules");
  }
  return t(lang, "skippedTooltipGeneric", { reason: skipReason });
}

function DecisionDisplay({
  decision,
  skipReason,
  lang,
}: {
  decision: string | null;
  skipReason: string | null;
  lang: Lang;
}) {
  return (
    <span style={decisionInline}>
      <code style={codeInline}>{decision ? decisionLabel(lang, decision) : "—"}</code>
      {skipReason ? (
        <span style={skipBadge} title={skipTooltip(skipReason, lang)}>
          ⏭️ {t(lang, "skipped")}
        </span>
      ) : null}
    </span>
  );
}

/* ---------- styles ---------- */

const page: React.CSSProperties = {
  padding: 16,
  background: "#f6f6f7",
  minHeight: "100%",
  fontFamily:
    'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif',
  color: "#202223",
} as any;

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};

const kicker: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
};

const subtle: React.CSSProperties = {
  color: "#6d7175",
  fontSize: 13,
};

const tabsWrap: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 12,
};

const langSelect: React.CSSProperties = {
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #dfe3e8",
  background: "#ffffff",
  fontSize: 13,
  outline: "none",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: active ? "1px solid #1a1a1a" : "1px solid #dfe3e8",
    background: active ? "#ffffff" : "#f6f6f7",
    boxShadow: active ? "0 1px 0 rgba(0,0,0,0.04)" : "none",
    cursor: "pointer",
    fontWeight: 600,
  };
}

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dfe3e8",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
};

const cardHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 12,
};

const divider: React.CSSProperties = {
  height: 1,
  background: "#edf0f2",
  margin: "12px 0",
};

const h2: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
};

const h3: React.CSSProperties = {
  margin: "0 0 10px 0",
  fontSize: 14,
  fontWeight: 700,
};

const tableOrders: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "auto",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #edf0f2",
  fontWeight: 700,
  fontSize: 12,
  color: "#6d7175",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const td: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f1f2f3",
  verticalAlign: "top",
  fontSize: 13,
};

const tdStrong: React.CSSProperties = {
  ...td,
  fontWeight: 600,
};

const link: React.CSSProperties = {
  color: "#005bd3",
  textDecoration: "none",
  fontWeight: 600,
};

const codeInline: React.CSSProperties = {
  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace',
  fontSize: 12,
  background: "#f6f6f7",
  padding: "2px 6px",
  borderRadius: 8,
  border: "1px solid #edf0f2",
};

const popoverTrigger: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  cursor: "pointer",
};

const popoverCard: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  marginTop: 6,
  zIndex: 20,
  background: "#ffffff",
  border: "1px solid #dfe3e8",
  borderRadius: 10,
  padding: "8px 10px",
  boxShadow: "0 8px 20px rgba(32,34,35,0.12)",
  minWidth: 240,
};

const popoverLine: React.CSSProperties = {
  fontSize: 12,
  color: "#202223",
  padding: "2px 0",
};

const decisionInline: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};

const skipBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #dfe3e8",
  background: "#f6f6f7",
  color: "#6d7175",
  fontSize: 12,
  fontWeight: 700,
};

function riskPill(level: "LOW" | "MEDIUM" | "HIGH"): React.CSSProperties {
  const bg = level === "HIGH" ? "#fbeae5" : level === "MEDIUM" ? "#fff5ea" : "#eafbea";
  const bd = level === "HIGH" ? "#f3c0b2" : level === "MEDIUM" ? "#f2d3a5" : "#bfe6bf";
  const fg = level === "HIGH" ? "#8a2a0a" : level === "MEDIUM" ? "#7a4a00" : "#0f5132";
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 999,
    border: `1px solid ${bd}`,
    background: bg,
    color: fg,
    fontSize: 12,
    fontWeight: 700,
  };
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: active ? "1px solid #202223" : "1px solid #dfe3e8",
    background: active ? "#202223" : "#ffffff",
    color: active ? "#ffffff" : "#202223",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  };
}

function toggleBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: enabled ? "1px solid #bfe6bf" : "1px solid #dfe3e8",
    background: enabled ? "#eafbea" : "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  };
}

const dangerBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #f3c0b2",
  background: "#fbeae5",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
};

const secondaryBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #dfe3e8",
  background: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #202223",
  background: "#202223",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 800,
};

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
  alignItems: "end",
};

const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const cardInner: React.CSSProperties = {
  border: "1px solid #e1e3e5",
  borderRadius: 16,
  padding: 14,
  background: "#ffffff",
};

const ruleFocusRow: React.CSSProperties = {
  background: "#fff5ea",
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#6d7175",
};

const control: React.CSSProperties = {
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #dfe3e8",
  background: "#ffffff",
  fontSize: 13,
  outline: "none",
};

const empty: React.CSSProperties = {
  border: "1px dashed #dfe3e8",
  borderRadius: 16,
  padding: 14,
  background: "#fbfbfb",
};

const tableRules: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
};

const cellControl: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #dfe3e8",
  background: "#ffffff",
  fontSize: 13,
  outline: "none",
};

const cellControlNarrow: React.CSSProperties = {
  ...cellControl,
  textAlign: "right",
};

const cellGroup: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1fr",
  gap: 8,
  alignItems: "center",
};

const cellControlCompact: React.CSSProperties = {
  ...cellControl,
  padding: "8px 8px",
};

function statusPill(kind: "idle" | "saving" | "saved" | "error"): React.CSSProperties {
  const map = {
    idle: { bg: "#f6f6f7", bd: "#dfe3e8", fg: "#6d7175" },
    saving: { bg: "#fff5ea", bd: "#f2d3a5", fg: "#7a4a00" },
    saved: { bg: "#eafbea", bd: "#bfe6bf", fg: "#0f5132" },
    error: { bg: "#fbeae5", bd: "#f3c0b2", fg: "#8a2a0a" },
  }[kind];

  return {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: `1px solid ${map.bd}`,
    background: map.bg,
    color: map.fg,
    whiteSpace: "nowrap",
  };
}

/* checklist styles */
const checkCard: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dfe3e8",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
};

const checkHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const checkList: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const checkItem: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
};

function checkIcon(done: boolean): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flex: "0 0 auto",
    border: done ? "1px solid #bfe6bf" : "1px solid #f2d3a5",
    background: done ? "#eafbea" : "#fff5ea",
    color: done ? "#0f5132" : "#7a4a00",
  };
}

function pillMini(kind: "ok" | "warn"): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: kind === "ok" ? "1px solid #bfe6bf" : "1px solid #f2d3a5",
    background: kind === "ok" ? "#eafbea" : "#fff5ea",
    color: kind === "ok" ? "#0f5132" : "#7a4a00",
    whiteSpace: "nowrap",
  };
}
