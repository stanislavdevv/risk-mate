import prisma from "../db.server";

export async function cleanupOnUninstall(shop: string) {
  console.log("[RiskMate] cleanupOnUninstall", { shop });
  await prisma.session.deleteMany({ where: { shop } });
  await prisma.riskResult.deleteMany({ where: { shop } });
  await prisma.riskRule.deleteMany({ where: { shop } });
}
