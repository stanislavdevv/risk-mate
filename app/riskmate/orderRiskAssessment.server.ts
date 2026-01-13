
import type { RiskLevel } from "./types";
export async function createOrderRiskAssessment(
  admin: any,
  orderGid: string,
  riskLevel: RiskLevel,
  facts: { description: string; sentiment: "NEGATIVE" | "NEUTRAL" | "POSITIVE" }[]
) {
  try {
    const res = await admin.graphql(
      `#graphql
      mutation RiskMateCreateRisk($input: OrderRiskAssessmentCreateInput!) {
        orderRiskAssessmentCreate(orderRiskAssessmentInput: $input) {
          orderRiskAssessment { riskLevel }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            orderId: orderGid,
            riskLevel,
            facts,
          },
        },
      }
    );

    const json = await res.json();
    const errs = json?.data?.orderRiskAssessmentCreate?.userErrors;
    if (errs?.length) {
      console.error("[RiskMate] orderRiskAssessmentCreate userErrors", errs);
    } else {
      console.log("[RiskMate] risk assessment created", {
        orderGid,
        riskLevel: json?.data?.orderRiskAssessmentCreate?.orderRiskAssessment?.riskLevel,
      });
    }
  } catch (e) {
    console.error("[RiskMate] orderRiskAssessmentCreate failed", e);
  }
}
