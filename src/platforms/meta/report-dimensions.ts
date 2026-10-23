/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { DIMENSION_CATALOG } from "./dimension-catalog.js";
import type { InsightsLevel } from "./types.js";

const accountMetadata = new Set([
  "account_timezone_name",
  "business_id",
  "business_name",
]);
export function metaDimensions(keys: string[], level: InsightsLevel) {
  return keys.map((key) => {
    const field = DIMENSION_CATALOG.find((f) => f.key === key);
    if (!field || !field.level.includes(level))
      throw new Error(`Dimension ${key} is unavailable at ${level} level.`);
    return field;
  });
}
export function insightDimensionKeys(keys: string[], level: InsightsLevel) {
  return metaDimensions(keys, level)
    .filter((f) => f.isInsightsField !== false && !accountMetadata.has(f.key))
    .map((f) => f.key);
}
type Row = Record<string, any>;
type Read = (
  path: string,
  params: Record<string, string | number>,
) => Promise<Row>;
function fieldExpansion(paths: string[]): string {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const [first, ...rest] = path.split(".");
    const existing = groups.get(first) ?? [];
    if (rest.length) existing.push(rest.join("."));
    groups.set(first, existing);
  }
  return [...groups]
    .map(([key, children]) =>
      children.length ? `${key}{${fieldExpansion(children)}}` : key,
    )
    .join(",");
}
/** Enrich only entities actually returned by account-scoped Insights. One
 * batched, account-scoped edge read per entity group, never one call per row. */
export async function enrichMetaDimensions(
  rows: Row[],
  keys: string[],
  level: InsightsLevel,
  accountId: string,
  read: Read,
) {
  const fields = metaDimensions(keys, level).filter(
    (f) => f.isInsightsField === false || accountMetadata.has(f.key),
  );
  if (!fields.length || !rows.length) return rows;
  const output = rows.map((row) => ({ ...row }));
  const groups = new Map<string, typeof fields>();
  for (const field of fields) {
    if (field.key === "action_attribution_windows") {
      // Account attribution is not resolved into explicit windows by Insights.
      for (const row of output) row[field.key] = null;
      continue;
    }
    const group =
      field.category === "account"
        ? "account"
        : field.category === "campaign" || field.key === "campaign_labels"
          ? "campaign"
          : field.category === "adset" ||
              field.key === "adset_labels" ||
              field.key === "attribution_setting"
            ? "adset"
            : field.category === "creative"
              ? "ad"
              : level;
    groups.set(group, [...(groups.get(group) ?? []), field]);
  }
  for (const [group, selected] of groups) {
    const paths = selected.map((f) =>
      f.apiField === "labels" || f.apiField === "ad_labels"
        ? "adlabels"
        : f.apiField,
    );
    const fieldsParam = fieldExpansion(["id", ...paths]);
    if (group === "account") {
      const account = await read(`/${accountId}`, { fields: fieldsParam });
      for (const row of output)
        for (const [i, f] of selected.entries())
          row[f.key] =
            paths[i].split(".").reduce((value, key) => value?.[key], account) ??
            null;
      continue;
    }
    const idField = `${group}_id`;
    const ids = [...new Set(rows.map((row) => String(row[idField] ?? "")))];
    if (ids.some((id) => !/^\d+$/.test(id)))
      throw new Error(`Missing ${group} identifier for metadata enrichment.`);
    const byId = new Map<string, Row>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const response = await read(
        `/${accountId}/${group === "adset" ? "adsets" : group + "s"}`,
        {
          fields: fieldsParam,
          limit: 500,
          filtering: JSON.stringify([
            {
              field: "id",
              operator: "IN",
              value: ids.slice(offset, offset + 100),
            },
          ]),
        },
      );
      if (!Array.isArray(response.data) || response.paging?.next)
        throw new Error(
          "Incomplete Meta entity metadata; narrow the selection and retry.",
        );
      for (const row of response.data) byId.set(String(row.id), row);
    }
    for (const row of output)
      for (const [i, f] of selected.entries())
        row[f.key] =
          paths[i]
            .split(".")
            .reduce(
              (value, key) => value?.[key],
              byId.get(String(row[idField])),
            ) ?? null;
  }
  return output;
}
