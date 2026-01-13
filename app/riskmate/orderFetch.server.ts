export async function addOrderTags(admin: any, orderGid: string, tags: string[]) {
  if (!tags?.length) return;

  try {
    const res = await admin.graphql(
      `#graphql
      mutation RiskMateAddTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
      { variables: { id: orderGid, tags } }
    );

    const json = await res.json();
    const errs = json?.data?.tagsAdd?.userErrors;
    if (errs?.length) {
      console.error("[RiskMate] tagsAdd userErrors", errs);
    } else {
      console.log("[RiskMate] tags added", { orderGid, tags });
    }
  } catch (e) {
    console.error("[RiskMate] tagsAdd failed", e);
  }
}
