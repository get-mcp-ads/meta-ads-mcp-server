/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import type { MetaApiRequest } from "./client.js";

export function measurementParams(
  request: MetaApiRequest,
): Record<string, string> {
  const mode = request.attributionMode;
  const windows = request.attributionWindows;
  if (mode === "explicit" && (!windows || windows.length === 0))
    throw Error("Explicit attribution requires at least one window.");
  if ((mode === "account" || mode === "adset") && windows?.length)
    throw Error(
      "Choose native attribution settings or explicit windows, not both.",
    );
  return {
    ...(mode === "account" ? { use_account_attribution_setting: "true" } : {}),
    ...(mode === "adset" ? { use_unified_attribution_setting: "true" } : {}),
    ...(windows?.length
      ? { action_attribution_windows: JSON.stringify(windows) }
      : {}),
    ...(request.actionReportTime
      ? { action_report_time: request.actionReportTime }
      : {}),
  };
}

export function reportingEvidence(
  results: Record<string, unknown>[][],
  requests: MetaApiRequest[],
  joinKeys: string[],
  rows: Record<string, unknown>[],
) {
  const key = (r: Record<string, unknown>) =>
    JSON.stringify(joinKeys.map((k) => r[k] ?? null));
  const indices = results.map(
    (group) => new Map(group.map((r) => [key(r), r])),
  );
  const missingRows = rows.filter(
    (r) =>
      requests.some((q) => q.fields.includes("spend")) &&
      !Object.hasOwn(r, "spend"),
  );
  return {
    source_queries: requests.map((q, i) => ({
      index: i,
      type: q.type,
      fields: q.fields,
      breakdowns: q.breakdowns ?? [],
      row_count: results[i].length,
      measurement_parameters: measurementParams(q),
      pagination_exhausted: true,
    })),
    row_provenance: rows.map((r) => ({
      key: Object.fromEntries(joinKeys.map((k) => [k, r[k] ?? null])),
      exact_source_queries: indices.flatMap((m, i) =>
        m.has(key(r)) ? [i] : [],
      ),
      missing_requested_fields: [
        ...new Set(requests.flatMap((q) => q.fields)),
      ].filter((f) => !Object.hasOwn(r, f)),
    })),
    rows_without_spend: missingRows.length,
    notes: [
      "The native conversions field is not a universal conversion total: missing conversions does not establish that purchases or leads are unavailable. Inspect actions and action_values, identify the exact action_type (for example offsite_conversion.fb_pixel_purchase for website purchases or omni_purchase for all-channel purchases), and keep missing values distinct from zero.",
      "Rows are merged from separate native queries; a missing field or missing query match is not proof of zero or of delivery outside the reporting period.",
      "Native attribution configuration is not inferred from numerical coincidences in action values. Explicit parameters are listed for each query.",
      "An action object may contain a window column without a value field. Preserve this absence; do not fill value from another window or label separate windows as a deduplicated combined total.",
      "Do not sum different purchase action types, attribution-window columns, or metrics broadcast across breakdown rows.",
      "Use native account_totals when requested for overall figures. Do not mix a subset spend denominator with conversions from another population.",
      "ROAS alone does not establish profitability. Missing counts do not establish future conversion growth.",
    ],
  };
}
