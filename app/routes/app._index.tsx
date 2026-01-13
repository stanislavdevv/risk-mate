// app/routes/app._index.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/* ---------- types ---------- */

type RuleType = "ORDER_VALUE" | "FIRST_TIME" | "HIGH_QTY" | "COUNTRY_MISMATCH";
type RuleOp = ">" | ">=" | "=" | "!=" | "<" | "<=";

type Rule = {
  id: string;
  type: RuleType;
  operator: RuleOp;
  value: string;
  points: number;
  action: string | null;
  enabled: boolean;
  createdAt: string;
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

  // ✅ trust
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
  | { ok: false; error: string };

/* ---------- loader ---------- */

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const shopRes = await admin.graphql(`
    query { shop { currencyCode } }
  `);

  const shopJson = await shopRes.json();
  const currency = shopJson?.data?.shop?.currencyCode ?? "UNKNOWN";

  const tab = (url.searchParams.get("tab") ?? "orders").toLowerCase();
  const level = (url.searchParams.get("level") ?? "ALL").toUpperCase();

  const rules = await prisma.riskRule.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  const where: any = { shop: session.shop };
  if (level === "LOW" || level === "MEDIUM" || level === "HIGH") where.riskLevel = level;

  const items = await prisma.riskResult.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const hasRules = rules.length > 0;
  const hasChecks = items.length > 0;

  return {
    shop: session.shop,
    currency,
    tab,
    level,
    hasRules,
    hasChecks,
    rules: rules.map(
      (r): Rule => ({
        id: r.id,
        type: r.type as RuleType,
        operator: r.operator as RuleOp,
        value: r.value,
        points: r.points,
        action: r.action,
        enabled: r.enabled,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    rows: items.map(
      (it): Row => {
        const orderId = orderIdFromGid(it.orderGid);
        const orderAdminUrl = orderId ? shopifyAdminOrderUrl(session.shop, orderId) : null;

        return {
          id: it.id,
          orderGid: it.orderGid,
          orderName: it.orderName,
          score: it.score,
          riskLevel: it.riskLevel as Row["riskLevel"],
          reasons: safeJsonParse(it.reasonsJson),
          createdAt: it.createdAt.toISOString(),
          updatedAt: it.updatedAt.toISOString(),
          orderAdminUrl,

          // ✅ trust (field-safe during migration)
          lastTopic: (it as any).lastTopic ?? null,
          lastEventAt: (it as any).lastEventAt ? (it as any).lastEventAt.toISOString() : null,
          eventCount: Number((it as any).eventCount ?? 0),
          lastRiskChangeAt: (it as any).lastRiskChangeAt ? (it as any).lastRiskChangeAt.toISOString() : null,
          lastDecision: (it as any).lastDecision ?? null,
          skipReason: (it as any).skipReason ?? null,
        };
      },
    ),
  };
}

/* ---------- action ---------- */

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  const allowedTypes: RuleType[] = ["ORDER_VALUE", "FIRST_TIME", "HIGH_QTY", "COUNTRY_MISMATCH"];
  const allowedOps: RuleOp[] = [">", ">=", "=", "!=", "<", "<="];

  const validate = (p: { type: string; operator: string; value: string; points: number }): string[] => {
    const errors: string[] = [];
    if (!allowedTypes.includes(p.type as RuleType)) errors.push("Unsupported rule type");
    if (!allowedOps.includes(p.operator as RuleOp)) errors.push("Unsupported operator");
    if (!p.value) errors.push("Value is required");
    if (!Number.isFinite(p.points)) errors.push("Points must be a number");

    if (p.type === "FIRST_TIME") {
      const v = p.value.toLowerCase();
      if (v !== "true" && v !== "false") errors.push("FIRST_TIME value must be true or false");
    }
    return errors;
  };

  // ✅ seed defaults (only if no rules)
  if (intent === "seedDefaultRules") {
    const existingCount = await prisma.riskRule.count({ where: { shop: session.shop } });
    if (existingCount > 0) {
      return json<ActionData>({ ok: false, error: "Defaults can be added only when there are no rules." }, 400);
    }

    const defaults: Array<{
      type: RuleType;
      operator: RuleOp;
      value: string;
      points: number;
      action: string | null;
      enabled: boolean;
    }> = [
        // High value
        { type: "ORDER_VALUE", operator: ">=", value: "300", points: 15, action: "REVIEW", enabled: true },
        { type: "ORDER_VALUE", operator: ">=", value: "500", points: 25, action: "HOLD", enabled: true },

        // First time buyer
        { type: "FIRST_TIME", operator: "=", value: "true", points: 10, action: "REVIEW", enabled: true },

        // High qty
        { type: "HIGH_QTY", operator: ">=", value: "5", points: 10, action: "REVIEW", enabled: true },
        { type: "HIGH_QTY", operator: ">=", value: "10", points: 20, action: "HOLD", enabled: true },

        // Country mismatch (engine interprets this)
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

    const errors = validate({ type, operator, value, points });
    if (errors.length) return json<ActionData>({ ok: false, error: errors.join("; ") }, 400);

    const created = await prisma.riskRule.create({
      data: {
        shop: session.shop,
        type,
        operator,
        value,
        points: Math.trunc(points),
        action: actionValue ? actionValue : null,
        enabled: true,
      },
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

    if (!id) return json<ActionData>({ ok: false, error: "Missing id" }, 400);

    const exists = await prisma.riskRule.findFirst({ where: { id, shop: session.shop } });
    if (!exists) return json<ActionData>({ ok: false, error: "Rule not found" }, 404);

    const points = Number(pointsRaw);
    const errors = validate({ type, operator, value, points });
    if (errors.length) return json<ActionData>({ ok: false, error: errors.join("; ") }, 400);

    await prisma.riskRule.update({
      where: { id },
      data: {
        type,
        operator,
        value,
        points: Math.trunc(points),
        action: actionValue ? actionValue : null,
      },
    });

    return json<ActionData>({ ok: true, op: "updateRule", id });
  }

  if (intent === "toggleRule") {
    const id = String(form.get("id") ?? "").trim();
    const enabled = String(form.get("enabled") ?? "") === "true";
    if (!id) return json<ActionData>({ ok: false, error: "Missing rule id" }, 400);

    const rule = await prisma.riskRule.findFirst({ where: { id, shop: session.shop } });
    if (!rule) return json<ActionData>({ ok: false, error: "Rule not found" }, 404);

    await prisma.riskRule.update({ where: { id }, data: { enabled } });
    return json<ActionData>({ ok: true, op: "toggleRule", id, enabled });
  }

  if (intent === "deleteRule") {
    const id = String(form.get("id") ?? "").trim();
    if (!id) return json<ActionData>({ ok: false, error: "Missing rule id" }, 400);

    const rule = await prisma.riskRule.findFirst({ where: { id, shop: session.shop } });
    if (!rule) return json<ActionData>({ ok: false, error: "Rule not found" }, 404);

    await prisma.riskRule.delete({ where: { id } });
    return json<ActionData>({ ok: true, op: "deleteRule", id });
  }

  return json<ActionData>({ ok: false, error: "Unknown action" }, 400);
}

/* ---------- component ---------- */

export default function AppIndex() {
  const data = useLoaderData() as LoaderData;
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") ?? "orders").toLowerCase();
  const level = (params.get("level") ?? "ALL").toUpperCase();

  const setTab = (next: "orders" | "rules") => {
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

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <div style={kicker}>RiskMate</div>
          <div style={subtle}>
            {data.shop} · Store currency: <b>{data.currency}</b>
          </div>
        </div>
      </header>

      <div style={tabsWrap}>
        <button type="button" onClick={() => setTab("orders")} style={tabBtn(tab === "orders")}>
          Orders
        </button>
        <button type="button" onClick={() => setTab("rules")} style={tabBtn(tab === "rules")}>
          Rules
        </button>
      </div>

      {tab === "orders" ? (
        <>
          <SetupChecklist hasRules={data.hasRules} hasChecks={data.hasChecks} shop={data.shop} />
          <div style={{ height: 12 }} />

          <section style={card}>
            <div style={cardHeaderRow}>
              <h2 style={h2}>Orders</h2>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setLevel("ALL")} style={pillBtn(level === "ALL")}>
                  All
                </button>
                <button onClick={() => setLevel("HIGH")} style={pillBtn(level === "HIGH")}>
                  High
                </button>
                <button onClick={() => setLevel("MEDIUM")} style={pillBtn(level === "MEDIUM")}>
                  Medium
                </button>
                <button onClick={() => setLevel("LOW")} style={pillBtn(level === "LOW")}>
                  Low
                </button>
              </div>
            </div>

            <div style={divider} />

            {data.rows.length === 0 ? (
              <EmptyState>No checks yet. Create or update a test order to trigger webhooks.</EmptyState>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableOrders}>
                  <thead>
                    <tr>
                      <th style={th}>Last event</th>
                      <th style={th}>Order</th>
                      <th style={th}>Score</th>
                      <th style={th}>Risk</th>
                      <th style={th}>Top reasons</th>
                      <th style={th}>Link</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        {/* Last event */}
                        <td style={td}>
                          {/* line 1: last event */}
                          <div>{formatDate(r.lastEventAt ?? r.updatedAt)}</div>

                          {/* line 2: topic + count */}
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6d7175" }}>
                            <code style={codeInline}>{r.lastTopic ?? "—"}</code>
                            <span style={{ marginLeft: 8 }}>×{r.eventCount ?? 0}</span>
                          </div>

                          {/* line 3: risk changed */}
                          <div style={{ marginTop: 6, fontSize: 12, color: "#6d7175" }}>
                            Risk changed: <span>{formatDate(r.lastRiskChangeAt)}</span>
                          </div>

                          {/* line 4: decision */}
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6d7175" }}>
                            Decision:{" "}
                            <code style={codeInline}>
                              {r.lastDecision ?? "—"}
                              {r.lastDecision === "SKIPPED" ? ` (${r.skipReason ?? "—"})` : ""}
                            </code>
                          </div>
                        </td>


                        {/* Order */}
                        <td style={tdStrong}>
                          {r.orderName}
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6d7175" }}>
                            <code style={codeInline}>{shortGid(r.orderGid)}</code>
                          </div>
                        </td>

                        {/* Score */}
                        <td style={td}>{r.score}</td>

                        {/* Risk */}
                        <td style={td}>
                          <span style={riskPill(r.riskLevel)}>{r.riskLevel}</span>
                        </td>

                        {/* Top reasons */}
                        <td style={td}>
                          {Array.isArray(r.reasons) && r.reasons.length ? (
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {r.reasons.slice(0, 3).map((x: any, i: number) => (
                                <li key={i}>
                                  <code style={codeInline}>{typeof x === "string" ? x : x.code ?? "REASON"}</code>
                                  {typeof x === "object" && x.details ? ` — ${x.details}` : ""}
                                </li>
                              ))}
                              {r.reasons.length > 3 ? <li>…</li> : null}
                            </ul>
                          ) : (
                            <span style={subtle}>—</span>
                          )}
                        </td>

                        {/* Link */}
                        <td style={td}>
                          {r.orderAdminUrl ? (
                            <a href={r.orderAdminUrl} target="_blank" rel="noreferrer" style={link}>
                              Open
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
      ) : (
        <RulesInline data={data} />
      )}
    </div>
  );
}

/* ---------- Rules inline editor (useFetcher autosave + status) ---------- */

function RulesInline({ data }: { data: LoaderData }) {
  const [localRules, setLocalRules] = useState<Rule[]>(data.rules);
  useEffect(() => setLocalRules(data.rules), [data.rules]);

  // fetchers
  const addFetcher = useFetcher<ActionData>();
  const seedFetcher = useFetcher<ActionData>();
  const saveFetcher = useFetcher<ActionData>();
  const mutateFetcher = useFetcher<ActionData>(); // toggle/delete

  const addFormRef = useRef<HTMLFormElement | null>(null);

  // autosave timers
  const timersRef = useRef<Record<string, number>>({});
  const lastPayloadRef = useRef<Record<string, string>>({});

  const allowedTypes: RuleType[] = ["ORDER_VALUE", "FIRST_TIME", "HIGH_QTY", "COUNTRY_MISMATCH"];
  const allowedOps: RuleOp[] = [">", ">=", "=", "!=", "<", "<="];

  // status pill
  const [ui, setUi] = useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({
    state: "idle",
  });

  const statusLabel = useMemo(() => {
    if (ui.state === "saving") return { text: "Saving…", style: statusPill("saving") };
    if (ui.state === "saved") return { text: "Saved", style: statusPill("saved") };
    if (ui.state === "error") return { text: ui.msg ? `Error: ${ui.msg}` : "Error", style: statusPill("error") };
    return { text: "—", style: statusPill("idle") };
  }, [ui]);

  // reflect saveFetcher state into UI
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

  // handle addRule result -> prepend into localRules + reset form
  useEffect(() => {
    const d = addFetcher.data;
    if (!d) return;
    if (!d.ok) return;
    if (d.op !== "addRule") return;

    setLocalRules((prev) => [d.rule, ...prev]);
    addFormRef.current?.reset();

    setUi({ state: "saved" });
    window.setTimeout(() => setUi((s) => (s.state === "saved" ? { state: "idle" } : s)), 900);
  }, [addFetcher.data]);

  // ✅ handle seed defaults -> set localRules
  useEffect(() => {
    const d = seedFetcher.data;
    if (!d) return;
    if (!d.ok) return;
    if (d.op !== "seedDefaults") return;

    setLocalRules(d.rules);
    setUi({ state: "saved" });
    window.setTimeout(() => setUi((s) => (s.state === "saved" ? { state: "idle" } : s)), 900);
  }, [seedFetcher.data]);

  // handle toggle/delete result -> update localRules
  useEffect(() => {
    const d = mutateFetcher.data;
    if (!d) return;
    if (!d.ok) return;

    if (d.op === "toggleRule") {
      setLocalRules((prev) => prev.map((r) => (r.id === d.id ? { ...r, enabled: d.enabled } : r)));
      return;
    }
    if (d.op === "deleteRule") {
      setLocalRules((prev) => prev.filter((r) => r.id !== d.id));
      return;
    }
  }, [mutateFetcher.data]);

  function submitUpdate(rule: Rule) {
    const payloadKey = JSON.stringify({
      id: rule.id,
      type: rule.type,
      operator: rule.operator,
      value: rule.value,
      points: rule.points,
      action: rule.action ?? "",
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

    timersRef.current[id] = window.setTimeout(() => {
      submitUpdate(rule);
    }, 700);
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
    if (!confirm("Delete this rule?")) return;
    const fd = new FormData();
    fd.set("_action", "deleteRule");
    fd.set("id", id);
    mutateFetcher.submit(fd, { method: "post", action: "?index" });
  }

  return (
    <section style={card}>
      <div style={cardHeaderRow}>
        <div>
          <h2 style={h2}>Rules</h2>
          <div style={subtle}>
            Inline edit · thresholds are in <b>{data.currency}</b>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={statusLabel.style}>{statusLabel.text}</span>
        </div>
      </div>

      <div style={divider} />

      {localRules.length === 0 ? (
        <>
          <EmptyState>No rules yet. Add your first rule below.</EmptyState>

          {/* ✅ Default rules button (only when no rules) */}
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <seedFetcher.Form method="post" action="?index">
              <input type="hidden" name="_action" value="seedDefaultRules" />
              <button type="submit" style={primaryBtn} disabled={seedFetcher.state !== "idle"}>
                {seedFetcher.state === "submitting" ? "Adding defaults…" : "Add default rules"}
              </button>
            </seedFetcher.Form>

            {seedFetcher.data && !seedFetcher.data.ok ? (
              <div style={{ fontSize: 13, color: "#8a2a0a" }}>Error: {seedFetcher.data.error}</div>
            ) : null}
          </div>
        </>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableRules}>
            <colgroup>
              <col style={{ width: 86 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 260 }} />
              <col style={{ width: 110 }} />
            </colgroup>

            <thead>
              <tr>
                <th style={th}>Enabled</th>
                <th style={th}>Type</th>
                <th style={th}>Operator</th>
                <th style={th}>Value</th>
                <th style={th}>Points</th>
                <th style={th}>Action</th>
                <th style={th}></th>
              </tr>
            </thead>

            <tbody>
              {localRules.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => toggleRule(r.id, !r.enabled)}
                      style={toggleBtn(r.enabled)}
                      disabled={mutateFetcher.state !== "idle"}
                    >
                      {r.enabled ? "On" : "Off"}
                    </button>
                  </td>

                  <td style={td}>
                    <select
                      value={r.type}
                      style={cellControl}
                      onChange={(e) => updateRuleLocal(r.id, { type: e.target.value as RuleType })}
                      onBlur={() => scheduleSave(r, true)}
                    >
                      {allowedTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={td}>
                    <select
                      value={r.operator}
                      style={cellControl}
                      onChange={(e) => updateRuleLocal(r.id, { operator: e.target.value as RuleOp })}
                      onBlur={() => scheduleSave(r, true)}
                    >
                      {allowedOps.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={td}>
                    <input
                      value={r.value}
                      style={cellControl}
                      onChange={(e) => updateRuleLocal(r.id, { value: e.target.value })}
                      onBlur={() => scheduleSave(r, true)}
                    />
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
                      placeholder="REVIEW / HOLD / TAG:foo"
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
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ height: 16 }} />
      <h3 style={h3}>Add rule</h3>

      <addFetcher.Form ref={addFormRef} method="post" action="?index" style={formGrid}>
        <input type="hidden" name="_action" value="addRule" />

        <label style={field}>
          <span style={label}>Type</span>
          <select name="type" defaultValue="ORDER_VALUE" style={control}>
            <option value="ORDER_VALUE">ORDER_VALUE</option>
            <option value="FIRST_TIME">FIRST_TIME</option>
            <option value="HIGH_QTY">HIGH_QTY</option>
            <option value="COUNTRY_MISMATCH">COUNTRY_MISMATCH</option>
          </select>
        </label>

        <label style={field}>
          <span style={label}>Operator</span>
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
          <span style={label}>Value</span>
          <input name="value" placeholder="300 / true / DE" style={control} />
        </label>

        <label style={field}>
          <span style={label}>Points</span>
          <input name="points" placeholder="15" defaultValue="15" style={control} />
        </label>

        <label style={field}>
          <span style={label}>Action</span>
          <input name="action" placeholder="TAG:high_value / REVIEW / HOLD" style={control} />
        </label>

        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" style={primaryBtn} disabled={addFetcher.state !== "idle"}>
            {addFetcher.state === "submitting" ? "Adding…" : "Add rule"}
          </button>
        </div>
      </addFetcher.Form>

      {addFetcher.data && !addFetcher.data.ok ? (
        <div style={{ marginTop: 10, fontSize: 13, color: "#8a2a0a" }}>Error: {addFetcher.data.error}</div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 13, color: "#6d7175" }}>
        Examples: <code style={codeInline}>FIRST_TIME = true</code>, <code style={codeInline}>ORDER_VALUE &gt; 300</code>,{" "}
        <code style={codeInline}>REVIEW</code>.
      </div>
    </section>
  );
}

/* ---------- Setup checklist (C.5) ---------- */

function SetupChecklist({
  hasRules,
  hasChecks,
  shop,
}: {
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
          <div style={{ fontWeight: 800 }}>Setup checklist</div>
          <div style={{ color: "#6d7175", fontSize: 13 }}>2 steps to start seeing consistent risk checks.</div>
        </div>
        <span style={pillMini("warn")}>Setup</span>
      </div>

      <div style={{ height: 10 }} />

      <div style={checkList}>
        <CheckItem
          done={hasRules}
          title="Create rules"
          desc={hasRules ? "Rules are configured." : "Go to Rules tab and add your first rules."}
        />

        <CheckItem
          done={hasChecks}
          title="Receive webhook events"
          desc={
            hasChecks
              ? "Webhook events are arriving and checks are being saved."
              : "Create a test order and update it to trigger orders/create and orders/updated."
          }
          extra={
            !hasChecks ? (
              <div style={{ marginTop: 6, fontSize: 13, color: "#202223" }}>
                Quick link:{" "}
                <a
                  href={`https://admin.shopify.com/store/${storeHandle}/orders`}
                  target="_blank"
                  rel="noreferrer"
                  style={link}
                >
                  Open Orders in Admin
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
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={empty}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing here yet</div>
      <div style={{ color: "#6d7175" }}>{children}</div>
    </div>
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
  gridTemplateColumns: "1.2fr 0.9fr 1.2fr 0.9fr 1.6fr auto",
  gap: 10,
  alignItems: "end",
};

const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
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
