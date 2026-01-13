import prisma from "../db.server";

export async function logRiskEvent(input: {
  shop: string;
  orderGid: string;
  orderName: string;
  topic: string;
  eventAt: Date;
  payloadHash?: string | null;
  decision?: string | null;   // "APPLIED" | "SKIPPED"
  skipReason?: string | null; // "UNCHANGED" | "NO_RULES" | ...
}) {
  await prisma.riskEvent.create({
    data: {
      shop: input.shop,
      orderGid: input.orderGid,
      orderName: input.orderName ?? "",
      topic: input.topic,
      eventAt: input.eventAt,
      payloadHash: input.payloadHash ?? null,
      decision: input.decision ?? null,
      skipReason: input.skipReason ?? null,
    },
  });
}
