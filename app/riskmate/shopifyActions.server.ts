import type { RiskLevel } from "./types";

const RISK_TAGS = new Set(["risk:low", "risk:medium", "risk:high"]);
const STATUS_TAGS = new Set(["risk_review", "risk_hold"]);

function normalizeTag(t: string) {
  return String(t ?? "").trim();
}

function levelTag(level: RiskLevel) {
  return `risk:${level.toLowerCase()}`; // LOW -> risk:low
}

export async function fetchOrderTags(admin: any, orderGid: string): Promise<string[]> {
  const res = await admin.graphql(
    `#graphql
    query RiskMateOrderTags($id: ID!) {
      order(id: $id) {
        id
        tags
      }
    }`,
    { variables: { id: orderGid } }
  );

  const json = await res.json();
  const tags = json?.data?.order?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.map(normalizeTag).filter(Boolean);
}

export async function tagsAdd(admin: any, orderGid: string, tags: string[]) {
  if (!tags.length) return;

  const res = await admin.graphql(
    `#graphql
    mutation RiskMateTagsAdd($id: ID!, $tags: [String!]!) {
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
  }
}

export async function tagsRemove(admin: any, orderGid: string, tags: string[]) {
  if (!tags.length) return;

  const res = await admin.graphql(
    `#graphql
    mutation RiskMateTagsRemove($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        userErrors { field message }
      }
    }`,
    { variables: { id: orderGid, tags } }
  );

  const json = await res.json();
  const errs = json?.data?.tagsRemove?.userErrors;
  if (errs?.length) {
    console.error("[RiskMate] tagsRemove userErrors", errs);
  }
}

/**
 * Делает теги "каноничными":
 * - всегда есть "risk-mate"
 * - ровно один risk:* (low|medium|high)
 * - review/hold по уровню/политике
 * - без накопления мусора
 */
export async function setOrderRiskTags(admin: any, orderGid: string, input: {
  level: RiskLevel;
  // дополнительные теги (если захочешь оставить TAG:xxx от правил, но для MVP можно оставить пустым)
  extra?: string[];
  // если true — будет чистить и risk_review/risk_hold перед установкой нового статуса
  cleanStatusTags?: boolean;
}) {
  const current = await fetchOrderTags(admin, orderGid);

  const toRemove: string[] = [];
  for (const t of current) {
    if (RISK_TAGS.has(t)) toRemove.push(t);
    if (input.cleanStatusTags && STATUS_TAGS.has(t)) toRemove.push(t);
  }

  const desired = new Set<string>();
  desired.add("risk-mate");
  desired.add(levelTag(input.level));

  // MVP политика (можно поменять в одном месте):
  if (input.level === "MEDIUM") desired.add("risk_review");
  if (input.level === "HIGH") desired.add("risk_hold");

  for (const t of (input.extra ?? [])) {
    const tag = normalizeTag(t);
    if (!tag) continue;
    // чтобы не дать мусору залезть в risk:*
    if (tag.startsWith("risk:")) continue;
    desired.add(tag);
  }

  // Добавляем только то, чего ещё нет
  const toAdd = Array.from(desired).filter((t) => !current.includes(t));

  try {
    if (toRemove.length) {
      await tagsRemove(admin, orderGid, toRemove);
      console.log("[RiskMate] tags removed", { orderGid, tags: toRemove });
    }
    if (toAdd.length) {
      await tagsAdd(admin, orderGid, toAdd);
      console.log("[RiskMate] tags added", { orderGid, tags: toAdd });
    }
  } catch (e) {
    console.error("[RiskMate] setOrderRiskTags failed", e);
  }
}
