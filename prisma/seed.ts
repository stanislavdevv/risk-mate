import prisma from "../app/db.server";

async function seed() {
  const shop = "smart-replier-store.myshopify.com";

  await prisma.riskRule.createMany({
    data: [
      {
        shop,
        type: "ORDER_VALUE",
        operator: ">",
        value: "300",
        points: 15,
        action: "TAG:high_value",
      },
      {
        shop,
        type: "FIRST_TIME",
        operator: "=",
        value: "true",
        points: 10,
        action: "REVIEW",
      },
    ],
  });
}

seed();
