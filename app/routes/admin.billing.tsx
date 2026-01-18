import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

type LoaderData = {
  shop: string;
  billing: {
    status: string;
    subscriptionId: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    updatedAt: string;
  } | null;
  transitions: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string;
    subscriptionId: string | null;
    changedAt: string;
  }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const billing = await prisma.billingState.findUnique({
    where: { shop: session.shop },
  });

  const transitions = await prisma.billingTransition.findMany({
    where: { shop: session.shop },
    orderBy: { changedAt: "desc" },
    take: 50,
  });

  return {
    shop: session.shop,
    billing: billing
      ? {
          status: billing.status,
          subscriptionId: billing.subscriptionId,
          trialEndsAt: billing.trialEndsAt ? billing.trialEndsAt.toISOString() : null,
          currentPeriodEnd: billing.currentPeriodEnd ? billing.currentPeriodEnd.toISOString() : null,
          updatedAt: billing.updatedAt.toISOString(),
        }
      : null,
    transitions: transitions.map((t) => ({
      id: t.id,
      fromStatus: t.fromStatus ?? null,
      toStatus: t.toStatus,
      reason: t.reason,
      subscriptionId: t.subscriptionId ?? null,
      changedAt: t.changedAt.toISOString(),
    })),
  } satisfies LoaderData;
};

export default function BillingAdmin() {
  const data = useLoaderData<LoaderData>();

  return (
    <div style={page}>
      <h2 style={h2}>Billing admin</h2>
      <div style={subtle}>{data.shop}</div>

      <section style={card}>
        <h3 style={h3}>Billing state</h3>
        {data.billing ? (
          <div style={grid}>
            <div>
              <div style={label}>Status</div>
              <div style={value}>{data.billing.status}</div>
            </div>
            <div>
              <div style={label}>Subscription</div>
              <div style={value}>{data.billing.subscriptionId ?? "—"}</div>
            </div>
            <div>
              <div style={label}>Trial ends</div>
              <div style={value}>{formatDate(data.billing.trialEndsAt)}</div>
            </div>
            <div>
              <div style={label}>Current period end</div>
              <div style={value}>{formatDate(data.billing.currentPeriodEnd)}</div>
            </div>
            <div>
              <div style={label}>Updated</div>
              <div style={value}>{formatDateTime(data.billing.updatedAt)}</div>
            </div>
          </div>
        ) : (
          <div style={subtle}>No billing state found.</div>
        )}
      </section>

      <section style={card}>
        <h3 style={h3}>Billing transitions</h3>
        {data.transitions.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>From</th>
                  <th style={th}>To</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Subscription</th>
                </tr>
              </thead>
              <tbody>
                {data.transitions.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{formatDateTime(row.changedAt)}</td>
                    <td style={td}>{row.fromStatus ?? "—"}</td>
                    <td style={td}>{row.toStatus}</td>
                    <td style={td}>{row.reason}</td>
                    <td style={td}>{row.subscriptionId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={subtle}>No transitions recorded.</div>
        )}
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

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

const page: React.CSSProperties = {
  padding: "24px 20px 60px",
  display: "grid",
  gap: 16,
};

const h2: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
};

const h3: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 16,
};

const subtle: React.CSSProperties = {
  fontSize: 12,
  color: "#6d7175",
};

const card: React.CSSProperties = {
  border: "1px solid #e1e3e5",
  borderRadius: 16,
  padding: 16,
  background: "#ffffff",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

const label: React.CSSProperties = {
  fontSize: 12,
  color: "#6d7175",
};

const value: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px",
  borderBottom: "1px solid #e1e3e5",
  color: "#6d7175",
  fontWeight: 700,
};

const td: React.CSSProperties = {
  padding: "8px",
  borderBottom: "1px solid #f1f2f3",
};
