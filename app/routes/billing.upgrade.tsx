import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const returnUrl = `${appUrl}/billing/confirm?shop=${encodeURIComponent(session.shop)}`;

  const res = await admin.graphql(
    `#graphql
    mutation RiskMateSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: true) {
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: "RiskMate Pro",
        returnUrl,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 4.99, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );

  const json = await res.json();
  const errors = json?.data?.appSubscriptionCreate?.userErrors;
  if (errors?.length) {
    console.error("[RiskMate] billing userErrors", errors);
    throw new Response("Billing error", { status: 400 });
  }

  const confirmationUrl = json?.data?.appSubscriptionCreate?.confirmationUrl;
  if (!confirmationUrl) {
    console.error("[RiskMate] billing missing confirmationUrl", json);
    throw new Response("Billing error", { status: 500 });
  }

  throw redirect(confirmationUrl);
};
