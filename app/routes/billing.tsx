import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getBillingAccess, updateBillingState } from "../riskmate/billing.server";
import { t, parseLang } from "../i18n/strings";

type LoaderData = {
  shop: string;
  status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  subscriptionId: string | null;
  billingAccess: Awaited<ReturnType<typeof getBillingAccess>>;
  lang: ReturnType<typeof parseLang>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const lang = parseLang(url.searchParams.get("lang"));

  await admin.graphql(`query { shop { id } }`);

  const billingAccess = await getBillingAccess(session.shop);
  const state = await prisma.billingState.findUnique({ where: { shop: session.shop } });

  return {
    shop: session.shop,
    status: state?.status ?? "TRIAL",
    trialEndsAt: state?.trialEndsAt ? state.trialEndsAt.toISOString() : null,
    currentPeriodEnd: state?.currentPeriodEnd ? state.currentPeriodEnd.toISOString() : null,
    subscriptionId: state?.subscriptionId ?? null,
    billingAccess,
    lang,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const lang = parseLang(url.searchParams.get("lang"));
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent !== "cancel") {
    return new Response(t(lang, "errorUnknownAction"), { status: 400 });
  }

  const state = await prisma.billingState.findUnique({ where: { shop: session.shop } });
  if (!state?.subscriptionId) {
    return new Response(t(lang, "billingNoSubscription"), { status: 400 });
  }

  const res = await admin.graphql(
    `#graphql
    mutation RiskMateSubscriptionCancel($id: ID!, $prorate: Boolean!) {
      appSubscriptionCancel(id: $id, prorate: $prorate) {
        appSubscription { id status }
        userErrors { field message }
      }
    }`,
    { variables: { id: state.subscriptionId, prorate: false } },
  );

  const json = await res.json();
  const errors = json?.data?.appSubscriptionCancel?.userErrors;
  if (errors?.length) {
    console.error("[RiskMate] billing cancel errors", errors);
    return new Response(t(lang, "billingCancelError"), { status: 400 });
  }

  await updateBillingState({
    shop: session.shop,
    status: "CANCELLED",
    reason: "SUBSCRIPTION_CANCELLED",
    subscriptionId: state.subscriptionId,
  });

  return null;
};

export default function BillingScreen() {
  const data = useLoaderData<LoaderData>();
  const statusLabel = t(data.lang, `billingStatus_${data.status}`);
  const trialDaysLeft = data.trialEndsAt ? daysLeft(data.trialEndsAt) : null;
  const showUpgrade = data.status !== "ACTIVE";
  const showCancel = data.status === "ACTIVE" && data.subscriptionId;

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <div style={kicker}>{t(data.lang, "billingTitle")}</div>
          <div style={subtle}>
            {data.shop} · {t(data.lang, "billingPlanLabel")}:{" "}
            <b>{data.status === "ACTIVE" ? t(data.lang, "billingPlanPro") : t(data.lang, "billingPlanTrial")}</b>
          </div>
        </div>
        <span style={statusPill(data.status)}>{statusLabel}</span>
      </header>

      <section style={card}>
        <div style={cardHeader}>
          <div>
            <h2 style={h2}>{t(data.lang, "billingSummaryTitle")}</h2>
            <div style={subtle}>{t(data.lang, "billingSummarySubtitle")}</div>
          </div>
        </div>

        <div style={divider} />

        <div style={grid}>
          <div style={item}>
            <div style={label}>{t(data.lang, "billingStatusLabel")}</div>
            <div style={value}>{statusLabel}</div>
          </div>
          <div style={item}>
            <div style={label}>{t(data.lang, "billingTrialLeft")}</div>
            <div style={value}>
              {trialDaysLeft !== null ? t(data.lang, "billingDaysLeft", { days: trialDaysLeft }) : "—"}
            </div>
          </div>
          <div style={item}>
            <div style={label}>{t(data.lang, "billingNextDate")}</div>
            <div style={value}>{formatDate(data.currentPeriodEnd)}</div>
          </div>
        </div>

        <div style={actions}>
          {showUpgrade ? (
            <a href="/billing/upgrade" style={primaryBtn}>
              {t(data.lang, "billingUpgradeCta")}
            </a>
          ) : null}
          {showCancel ? (
            <Form method="post">
              <input type="hidden" name="_action" value="cancel" />
              <button type="submit" style={secondaryBtn}>
                {t(data.lang, "billingCancelCta")}
              </button>
            </Form>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function daysLeft(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  return days;
}

const page: React.CSSProperties = {
  padding: "24px 20px 60px",
  display: "grid",
  gap: 16,
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const kicker: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
  color: "#6d7175",
};

const subtle: React.CSSProperties = {
  fontSize: 13,
  color: "#6d7175",
};

const card: React.CSSProperties = {
  border: "1px solid #e1e3e5",
  borderRadius: 16,
  padding: 16,
  background: "#ffffff",
};

const cardHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const h2: React.CSSProperties = {
  fontSize: 18,
  margin: 0,
};

const divider: React.CSSProperties = {
  height: 1,
  background: "#e1e3e5",
  margin: "16px 0",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const item: React.CSSProperties = {
  display: "grid",
  gap: 4,
};

const label: React.CSSProperties = {
  fontSize: 12,
  color: "#6d7175",
};

const value: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const actions: React.CSSProperties = {
  marginTop: 16,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #202223",
  background: "#202223",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 800,
  textDecoration: "none",
};

const secondaryBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #dfe3e8",
  background: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
};

function statusPill(status: LoaderData["status"]): React.CSSProperties {
  const map = {
    TRIAL: { bg: "#fff5ea", bd: "#f2d3a5", fg: "#7a4a00" },
    ACTIVE: { bg: "#eafbea", bd: "#bfe6bf", fg: "#0f5132" },
    EXPIRED: { bg: "#fbeae5", bd: "#f3c0b2", fg: "#8a2a0a" },
    CANCELLED: { bg: "#f3f4f5", bd: "#dfe3e8", fg: "#5f6368" },
  } as const;
  const tone = map[status];
  return {
    padding: "4px 10px",
    borderRadius: 999,
    border: `1px solid ${tone.bd}`,
    background: tone.bg,
    color: tone.fg,
    fontWeight: 800,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
}
