import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticate } from "../shopify.server";
import { updateBillingState } from "../riskmate/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  if (!chargeId) {
    throw new Response("Missing charge_id", { status: 400 });
  }

  const subscriptionGid = `gid://shopify/AppSubscription/${chargeId}`;

  const res = await admin.graphql(
    `#graphql
    query RiskMateSubscription($id: ID!) {
      appSubscription(id: $id) {
        id
        status
        currentPeriodEnd
      }
    }`,
    { variables: { id: subscriptionGid } },
  );

  const json = await res.json();
  const subscription = json?.data?.appSubscription;
  const status = subscription?.status as string | undefined;

  if (status !== "ACTIVE") {
    console.warn("[RiskMate] billing not active", { shop: session.shop, status });
    throw redirect(`/app?shop=${encodeURIComponent(session.shop)}`);
  }

  await updateBillingState({
    shop: session.shop,
    status: "ACTIVE",
    reason: "SUBSCRIPTION_ACTIVATED",
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
  });

  throw redirect(`/app?shop=${encodeURIComponent(session.shop)}`);
};
