import prisma from "../db.server";

export type BillingAccess = {
  status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  isTrial: boolean;
  canUseApp: boolean;
  needsUpgrade: boolean;
  trialEndsAt: Date | null;
};

const TRIAL_DAYS = 7;

function trialEndFromNow() {
  return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

async function recordBillingTransition(input: {
  shop: string;
  fromStatus: BillingAccess["status"] | null;
  toStatus: BillingAccess["status"];
  reason: string;
  subscriptionId?: string | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
}) {
  await prisma.billingTransition.create({
    data: {
      shop: input.shop,
      fromStatus: input.fromStatus ?? undefined,
      toStatus: input.toStatus,
      reason: input.reason,
      subscriptionId: input.subscriptionId ?? undefined,
      trialEndsAt: input.trialEndsAt ?? undefined,
      currentPeriodEnd: input.currentPeriodEnd ?? undefined,
    },
  });
}

export async function updateBillingState(input: {
  shop: string;
  status: BillingAccess["status"];
  reason: string;
  trialEndsAt?: Date | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
}) {
  const existing = await prisma.billingState.findUnique({ where: { shop: input.shop } });

  const next = existing
    ? await prisma.billingState.update({
        where: { shop: input.shop },
        data: {
          status: input.status,
          trialEndsAt: input.trialEndsAt ?? existing.trialEndsAt,
          subscriptionId: input.subscriptionId ?? existing.subscriptionId,
          currentPeriodEnd: input.currentPeriodEnd ?? existing.currentPeriodEnd,
        },
      })
    : await prisma.billingState.create({
        data: {
          shop: input.shop,
          status: input.status,
          trialEndsAt: input.trialEndsAt ?? null,
          subscriptionId: input.subscriptionId ?? null,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
        },
      });

  if (!existing || existing.status !== next.status) {
    await recordBillingTransition({
      shop: input.shop,
      fromStatus: existing?.status ?? null,
      toStatus: next.status as BillingAccess["status"],
      reason: input.reason,
      subscriptionId: next.subscriptionId,
      trialEndsAt: next.trialEndsAt,
      currentPeriodEnd: next.currentPeriodEnd,
    });
  }

  return next;
}

export async function getBillingAccess(shop: string): Promise<BillingAccess> {
  let state = await prisma.billingState.findUnique({ where: { shop } });

  if (!state) {
    state = await updateBillingState({
      shop,
      status: "TRIAL",
      trialEndsAt: trialEndFromNow(),
      reason: "INIT_TRIAL",
    });
  }

  if (state.status === "TRIAL" && state.trialEndsAt && Date.now() > state.trialEndsAt.getTime()) {
    state = await updateBillingState({
      shop,
      status: "EXPIRED",
      reason: "TRIAL_EXPIRED",
    });
  }

  const isTrial = state.status === "TRIAL";
  const canUseApp = state.status === "ACTIVE" || isTrial;
  const needsUpgrade = state.status === "EXPIRED" || state.status === "CANCELLED";

  return {
    status: state.status as BillingAccess["status"],
    isTrial,
    canUseApp,
    needsUpgrade,
    trialEndsAt: state.trialEndsAt,
  };
}
