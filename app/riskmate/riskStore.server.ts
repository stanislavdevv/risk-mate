// app/riskmate/riskStore.server.ts
import prisma from "../db.server";

export async function upsertRiskIfChanged(input: {
  shop: string;
  orderGid: string;
  orderName: string;
  score: number;
  riskLevel: string;
  reasonsJson: string;

  // trust + idempotency
  payloadHash: string;
  lastTopic: string;
  lastEventAt: Date;

  // decision context
  skipReasonIfUnchanged?: string; // default: "UNCHANGED"
}): Promise<{ skipped: boolean }> {
  const existing = await prisma.riskResult.findUnique({
    where: { shop_orderGid: { shop: input.shop, orderGid: input.orderGid } },
    select: {
      id: true,
      payloadHash: true,
    },
  });

  const unchangedByHash = !!existing && (existing.payloadHash ?? "") === (input.payloadHash ?? "");

  // ✅ always update trust fields + decision
  if (unchangedByHash) {
    await prisma.riskResult.update({
      where: { shop_orderGid: { shop: input.shop, orderGid: input.orderGid } },
      data: {
        orderName: input.orderName ?? "",

        // trust
        lastTopic: input.lastTopic,
        lastEventAt: input.lastEventAt,
        eventCount: { increment: 1 },

        // decision
        lastDecision: "SKIPPED",
        skipReason: input.skipReasonIfUnchanged ?? "UNCHANGED",
      },
    });

    return { skipped: true };
  }

  const now = input.lastEventAt;

  await prisma.riskResult.upsert({
    where: { shop_orderGid: { shop: input.shop, orderGid: input.orderGid } },
    create: {
      shop: input.shop,
      orderGid: input.orderGid,
      orderName: input.orderName ?? "",
      score: input.score,
      riskLevel: input.riskLevel,
      reasonsJson: input.reasonsJson,

      // trust
      payloadHash: input.payloadHash,
      lastTopic: input.lastTopic,
      lastEventAt: input.lastEventAt,
      eventCount: 1,

      // decision
      lastDecision: "APPLIED",
      skipReason: null,

      // ✅ risk changed (first time is also a change)
      lastRiskChangeAt: now,
    },
    update: {
      orderName: input.orderName ?? "",
      score: input.score,
      riskLevel: input.riskLevel,
      reasonsJson: input.reasonsJson,

      // trust
      payloadHash: input.payloadHash,
      lastTopic: input.lastTopic,
      lastEventAt: input.lastEventAt,
      eventCount: { increment: 1 },

      // decision
      lastDecision: "APPLIED",
      skipReason: null,

      // ✅ changed
      lastRiskChangeAt: now,
    },
  });

  return { skipped: false };
}
