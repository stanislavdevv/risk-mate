import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { parseLang, t } from "../i18n/strings";
import { getBillingAccess } from "../riskmate/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const billingAccess = await getBillingAccess(session.shop);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", billingAccess };
};

export default function App() {
  const { apiKey, billingAccess } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const lang = parseLang(params.get("lang"));
  const langParam = params.get("lang");
  const langQuery = langParam ? `?lang=${encodeURIComponent(langParam)}` : "";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href={`/app${langQuery}`}>{t(lang, "navHome")}</s-link>
        <s-link href={`/billing${langQuery}`}>{t(lang, "billingNav")}</s-link>
      </s-app-nav>
      {billingAccess.needsUpgrade ? (
        <div style={banner}>
          <div>
            <div style={{ fontWeight: 700 }}>{t(lang, "billingUpgradeTitle")}</div>
            <div style={{ fontSize: 12, color: "#6d7175" }}>{t(lang, "billingUpgradeBody")}</div>
          </div>
          <a href={`/billing/upgrade${langQuery}`} style={bannerCta}>
            {t(lang, "billingUpgradeCta")}
          </a>
        </div>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

const banner: React.CSSProperties = {
  margin: "12px 16px",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #eadab8",
  background: "#fff9ef",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const bannerCta: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #202223",
  background: "#202223",
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 800,
  fontSize: 12,
};

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
