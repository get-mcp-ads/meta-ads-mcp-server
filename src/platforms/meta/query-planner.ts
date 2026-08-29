/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// ============================================
// META MARKETING API QUERY PLANNER
// Splits incompatible metrics/breakdowns into separate API calls
// ============================================

import {
  InsightsQueryRequest,
  QueryPlan,
  MetaApiRequest,
  InsightsLevel,
} from "./types.js";
import { getMetricByKey } from "./metric-catalog.js";
import {
  validateQuerySelection,
  getApiFieldsForMetrics,
  metricsRequireActionBreakdowns,
  isActionBasedMetric,
  ACTION_BASED_METRICS,
  CREATIVE_BREAKDOWNS,
  CREATIVE_BREAKDOWN_SUPPORTED_METRICS,
} from "./compatibility-rules.js";
import { getRequiredCombinations } from "./breakdown-catalog.js";
import { getDimensionApiFields } from "./dimension-catalog.js";
import { logger } from "../../core/logger.js";

// ============================================
// QUERY PLANNER
// ============================================

/**
 * Ensure all required breakdown combinations are included
 * For example: platform_position and impression_device require publisher_platform
 */
function ensureRequiredBreakdowns(breakdowns: string[]): string[] {
  const result = new Set(breakdowns);

  for (const breakdown of breakdowns) {
    const required = getRequiredCombinations(breakdown);
    for (const req of required) {
      if (!result.has(req)) {
        result.add(req);
      }
    }
  }

  return Array.from(result);
}

/**
 * Action breakdown keys that should NEVER be in regular breakdowns array
 */
const ACTION_BREAKDOWN_KEYS = [
  "action_type",
  "action_device",
  "action_destination",
  "action_target_id",
  "action_reaction",
  "action_video_sound",
  "action_video_type",
  "action_carousel_card_id",
  "action_carousel_card_name",
  "action_canvas_component_name",
  "conversion_destination",
  "standard_event_content_type",
  "signal_source_bucket",
  "is_business_ai_assisted",
];

/**
 * Plan queries for an insights request
 * Splits incompatible metrics/breakdowns into separate API calls
 */
export function planQueries(request: InsightsQueryRequest): QueryPlan {
  const { metrics, breakdowns: rawBreakdowns = [], actionBreakdowns: rawActionBreakdowns = [], level } = request;

  const warnings: string[] = [];
  const errors: string[] = [];

  // DEFENSIVE: Ensure action breakdowns are NEVER in regular breakdowns array
  // This fixes issues with persisted state or incorrect UI state
  const cleanedBreakdowns = rawBreakdowns.filter((b) => {
    if (ACTION_BREAKDOWN_KEYS.includes(b)) {
      warnings.push(
        `"${b}" is an action breakdown and was removed from regular breakdowns. Use the Action Breakdowns section instead.`
      );
      return false;
    }
    return true;
  });

  // DEFENSIVE: Ensure regular breakdowns are NEVER in action breakdowns array
  const cleanedActionBreakdowns = rawActionBreakdowns.filter((b) => {
    if (!ACTION_BREAKDOWN_KEYS.includes(b)) {
      warnings.push(
        `"${b}" is not an action breakdown and was removed from action breakdowns.`
      );
      return false;
    }
    return true;
  });

  // Ensure required breakdown combinations are included
  // e.g., platform_position and impression_device require publisher_platform
  const breakdowns = ensureRequiredBreakdowns(cleanedBreakdowns);
  const actionBreakdowns = cleanedActionBreakdowns;

  // Notify if we added required breakdowns
  if (breakdowns.length > cleanedBreakdowns.length) {
    const added = breakdowns.filter(b => !cleanedBreakdowns.includes(b));
    warnings.push(
      `Auto-added required breakdown(s): ${added.join(", ")}. Some breakdowns require specific combinations to work.`
    );
  }

  // Validate the selection first
  const validation = validateQuerySelection(
    metrics,
    breakdowns,
    actionBreakdowns,
    level
  );
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  // If there are errors, return early
  if (errors.length > 0) {
    return {
      requests: [],
      calculatedMetrics: [],
      joinKeys: getJoinKeys(level, breakdowns),
      warnings,
      errors,
    };
  }

  // Identify calculated metrics
  const calculatedMetricKeys = metrics.filter((m) => {
    const metric = getMetricByKey(m);
    return metric?.type === "calculated";
  });

  // Get all native metrics needed (including required fields for calculated)
  const nativeMetrics = getNativeMetricsNeeded(metrics);

  // Check if we have creative breakdowns
  const hasCreativeBreakdowns = breakdowns.some((b) =>
    CREATIVE_BREAKDOWNS.includes(b)
  );

  // Check if we have action breakdowns
  const hasActionBreakdowns = actionBreakdowns.length > 0;

  // Build API requests
  const requests: MetaApiRequest[] = [];

  if (hasCreativeBreakdowns) {
    // Creative breakdowns have strict limitations
    requests.push(
      ...planCreativeBreakdownRequests(
        nativeMetrics,
        breakdowns,
        actionBreakdowns,
        level,
        request
      )
    );
  } else if (hasActionBreakdowns || metricsRequireActionBreakdowns(nativeMetrics)) {
    // Need to separate delivery metrics from action metrics
    requests.push(
      ...planActionMetricRequests(
        nativeMetrics,
        breakdowns,
        actionBreakdowns,
        level,
        request
      )
    );
  } else {
    // Simple case - all metrics can be fetched together
    const apiFields = getApiFieldsForMetrics(nativeMetrics);
    requests.push(
      createRequest("delivery", apiFields, breakdowns, [], level, request)
    );
  }

  return {
    requests,
    calculatedMetrics: calculatedMetricKeys,
    joinKeys: getJoinKeys(level, breakdowns),
    warnings,
    errors,
  };
}

/**
 * Get all native metrics needed, including required fields for calculated metrics
 */
function getNativeMetricsNeeded(metrics: string[]): string[] {
  const nativeMetrics: Set<string> = new Set();

  for (const metricKey of metrics) {
    const metric = getMetricByKey(metricKey);
    if (!metric) continue;

    // Skip deprecated metrics - they cause API errors
    // (e.g., video_10_sec_watched_actions is no longer valid in Meta API)
    if (metric.isDeprecated) {
      logger.warn("meta", "Skipping deprecated metric", { metricKey });
      continue;
    }

    if (metric.type === "calculated" && metric.requiredFields) {
      // Add required fields for calculated metrics
      for (const field of metric.requiredFields) {
        nativeMetrics.add(field);
      }
    } else {
      // Add the metric itself
      nativeMetrics.add(metricKey);
    }
  }

  return Array.from(nativeMetrics);
}

/**
 * Plan requests when creative breakdowns are used
 *
 * IMPORTANT: Creative breakdowns (image_asset, video_asset, media_type, etc.)
 * CANNOT be combined with action_type (action_breakdown).
 *
 * Strategy:
 * 1. Creative request: metrics + creative breakdowns (aggregated data per creative asset)
 * 2. Action request: action fields + action_type (NO creative breakdowns) - for action breakdown data
 * 3. Delivery request: non-creative-compatible metrics with non-creative breakdowns
 */
function planCreativeBreakdownRequests(
  metrics: string[],
  breakdowns: string[],
  actionBreakdowns: string[],
  level: InsightsLevel,
  request: InsightsQueryRequest
): MetaApiRequest[] {
  const requests: MetaApiRequest[] = [];

  // Separate creative breakdowns from non-creative breakdowns
  const creativeBreakdowns = breakdowns.filter((b) =>
    CREATIVE_BREAKDOWNS.includes(b)
  );
  const nonCreativeBreakdowns = breakdowns.filter(
    (b) => !CREATIVE_BREAKDOWNS.includes(b)
  );

  // Separate metrics into those compatible with creative breakdowns and those that aren't
  const creativeCompatibleMetrics = metrics.filter((m) =>
    CREATIVE_BREAKDOWN_SUPPORTED_METRICS.includes(m)
  );
  const creativeIncompatibleMetrics = metrics.filter(
    (m) => !CREATIVE_BREAKDOWN_SUPPORTED_METRICS.includes(m)
  );

  // Identify if we have action-based metrics that need action_type breakdown
  // Use isActionBasedMetric() to check both direct action fields AND metrics that extract from action arrays
  // (e.g., "purchases" extracts from actions[action_type="offsite_conversion.fb_pixel_purchase"])
  const hasActionMetrics = metrics.some((m) => isActionBasedMetric(m));
  const needsActionBreakdown = actionBreakdowns.length > 0 || hasActionMetrics;

  // Request 1: Creative-compatible metrics with creative breakdowns ONLY
  // This gives us aggregated data per creative asset (no action_type breakdown)
  if (creativeCompatibleMetrics.length > 0 && creativeBreakdowns.length > 0) {
    // Remove action-based metrics from creative request if we'll have a separate action request
    // This avoids duplicate data and confusion
    const creativeOnlyMetrics = needsActionBreakdown
      ? creativeCompatibleMetrics.filter((m) => !ACTION_BASED_METRICS.includes(m))
      : creativeCompatibleMetrics;

    if (creativeOnlyMetrics.length > 0) {
      const apiFields = getApiFieldsForMetrics(creativeOnlyMetrics);
      requests.push(
        createRequest("creative", apiFields, creativeBreakdowns, [], level, request)
      );
    }
  }

  // Request 2: Action metrics
  // When creative breakdowns are used, action metrics need special handling:
  // - Creative breakdowns (image_asset, video_asset) CANNOT be combined with action_type
  // - But NON-creative breakdowns CAN be included if no explicit action_breakdowns
  if (needsActionBreakdown) {
    const actionFields = getApiFieldsForMetrics([
      "actions",
      "action_values",
      "cost_per_action_type",
    ]);

    if (actionBreakdowns.length > 0) {
      // User explicitly wants action breakdowns - can't combine with any breakdowns
      requests.push(
        createRequest(
          "actions",
          actionFields,
          [], // No breakdowns - entity level data
          actionBreakdowns,
          level,
          request
        )
      );
    } else if (nonCreativeBreakdowns.length > 0) {
      // Include non-creative breakdowns (age, gender, etc.) for proper breakdown data
      requests.push(
        createRequest(
          "actions",
          actionFields,
          nonCreativeBreakdowns, // Include regular breakdowns
          [], // No action_breakdowns - prevents implicit action_type
          level,
          request
        )
      );
    } else {
      // No breakdowns at all - just get entity level action data
      requests.push(
        createRequest(
          "actions",
          actionFields,
          [],
          [], // No action_breakdowns
          level,
          request
        )
      );
    }
  }

  // Request 3: Non-creative-compatible metrics with non-creative breakdowns
  // Separate delivery metrics from action metrics
  // IMPORTANT: Include "video" category - video metrics are NOT action-based,
  // they return as direct fields (AdsActionStats[]) like video_p25_watched_actions
  const deliveryMetrics = creativeIncompatibleMetrics.filter((m) => {
    const metric = getMetricByKey(m);
    return (
      metric?.category === "delivery" ||
      metric?.category === "cost" ||
      metric?.category === "engagement" ||
      metric?.category === "video"  // Video metrics are NOT action-based!
    );
  });

  // Request for delivery metrics WITH non-creative breakdowns
  // IMPORTANT: When breakdowns are selected, we MUST always send a delivery request
  // to get the breakdown structure in the response, even if no delivery metrics were selected
  if (nonCreativeBreakdowns.length > 0) {
    // Always send delivery request when breakdowns are selected
    const metricsToRequest = deliveryMetrics.length > 0
      ? deliveryMetrics
      : ["impressions"]; // Fallback to impressions to get breakdown rows

    const deliveryFields = getApiFieldsForMetrics(metricsToRequest);
    requests.push(
      createRequest(
        "delivery",
        deliveryFields,
        nonCreativeBreakdowns,
        [],
        level,
        request
      )
    );
  } else if (deliveryMetrics.length > 0) {
    // No breakdowns at all, but we have delivery metrics - send them
    const deliveryFields = getApiFieldsForMetrics(deliveryMetrics);
    requests.push(
      createRequest("delivery", deliveryFields, [], [], level, request)
    );
  }

  return requests;
}

/**
 * Breakdowns that CAN be combined with action_type (action_breakdowns)
 * According to Meta API documentation, these are the only valid combinations
 */
/**
 * Plan requests when action metrics or action breakdowns are needed
 *
 * IMPORTANT: action_type (action_breakdown) CANNOT be combined with most regular breakdowns.
 * The API will return error: "Current combination of data breakdown columns is invalid"
 *
 * Strategy:
 * 1. Delivery metrics WITH regular breakdowns (no action_breakdowns)
 * 2. Action metrics WITHOUT regular breakdowns (action data aggregated at entity level)
 */
function planActionMetricRequests(
  metrics: string[],
  breakdowns: string[],
  actionBreakdowns: string[],
  level: InsightsLevel,
  request: InsightsQueryRequest
): MetaApiRequest[] {
  const requests: MetaApiRequest[] = [];

  // Separate delivery metrics from action-based metrics
  // IMPORTANT: Video metrics are NOT action-based! They return as direct fields
  // (AdsActionStats[] like video_p25_watched_actions), not via the actions array
  const deliveryMetrics = metrics.filter((m) => {
    const metric = getMetricByKey(m);
    return (
      metric?.category === "delivery" ||
      metric?.category === "cost" ||
      metric?.category === "engagement" ||
      metric?.category === "video"  // Video metrics should be in delivery request!
    );
  });

  const actionMetrics = metrics.filter((m) => {
    const metric = getMetricByKey(m);
    // Use isActionBasedMetric() to properly detect all action-based metrics
    // including those that extract from action arrays (e.g., "purchases")
    // NOTE: Video metrics are NOT action-based despite returning AdsActionStats[]
    return (
      isActionBasedMetric(m) ||
      metric?.category === "conversion"
    );
  });

  // Request 1: Delivery metrics with standard breakdowns (NO action_breakdowns)
  // IMPORTANT: When breakdowns are selected, we MUST always send a delivery request
  // to get the breakdown structure in the response. If no delivery metrics were selected,
  // include at least "impressions" to get the breakdown rows.
  if (breakdowns.length > 0) {
    // Always send delivery request when breakdowns are selected
    const metricsToRequest = deliveryMetrics.length > 0
      ? deliveryMetrics
      : ["impressions"]; // Fallback to impressions to get breakdown rows

    const apiFields = getApiFieldsForMetrics(metricsToRequest);
    requests.push(
      createRequest("delivery", apiFields, breakdowns, [], level, request)
    );
  } else if (deliveryMetrics.length > 0) {
    // No breakdowns, but we have delivery metrics - send them
    const apiFields = getApiFieldsForMetrics(deliveryMetrics);
    requests.push(
      createRequest("delivery", apiFields, [], [], level, request)
    );
  }

  // Request 2: Action metrics
  // UPDATED RULE: When user has NOT explicitly selected action_breakdowns,
  // we CAN include regular breakdowns with action metrics.
  // The key insight is:
  // - action_type is implicitly added ONLY if action_breakdowns param is absent
  // - If we explicitly pass action_breakdowns as empty [], Meta won't add action_type
  // - This allows combining regular breakdowns (age, gender) with action metrics
  //
  // When user HAS explicitly selected action_breakdowns (like action_device),
  // we CANNOT combine with regular breakdowns - use entity-level merge instead.
  if (actionMetrics.length > 0) {
    const apiFields = getApiFieldsForMetrics(actionMetrics);

    const hasExplicitActionBreakdowns = actionBreakdowns.length > 0;

    if (hasExplicitActionBreakdowns) {
      // User explicitly wants action breakdowns - can't combine with regular breakdowns
      // Request WITHOUT regular breakdowns, merge at entity level
      requests.push(
        createRequest(
          "actions",
          apiFields,
          [], // No regular breakdowns - will be merged at entity level
          actionBreakdowns,
          level,
          request
        )
      );
    } else {
      // No explicit action breakdowns - include regular breakdowns for proper data
      // This gives us action data broken down by age, gender, etc.
      requests.push(
        createRequest(
          "actions",
          apiFields,
          breakdowns, // Include regular breakdowns for breakdown-level data
          [], // Empty action_breakdowns - prevents implicit action_type
          level,
          request
        )
      );
    }
  }

  return requests;
}

/**
 * Create a Meta API request object
 * Includes validation to ensure creative breakdowns and action breakdowns are never combined
 */
function createRequest(
  type: "delivery" | "actions" | "video" | "creative",
  fields: string[],
  breakdowns: string[],
  actionBreakdowns: string[],
  level: InsightsLevel,
  request: InsightsQueryRequest
): MetaApiRequest {
  // CRITICAL VALIDATION: Creative breakdowns and action breakdowns CANNOT be combined
  // Meta API validates ALL breakdown dimensions together and will reject invalid combinations
  const hasCreativeBreakdowns = breakdowns.some((b) => CREATIVE_BREAKDOWNS.includes(b));
  const hasActionBreakdowns = actionBreakdowns.length > 0;

  if (hasCreativeBreakdowns && hasActionBreakdowns) {
    // This should never happen if query planner is working correctly
    // Log error for debugging and strip action breakdowns to prevent API error
    console.error(
      "[QueryPlanner] CRITICAL: Creative breakdowns combined with action breakdowns!",
      { breakdowns, actionBreakdowns, type }
    );
    // Strip action breakdowns from this request - they will be in a separate request
    actionBreakdowns = [];
  }

  // Also validate that action breakdowns aren't in the regular breakdowns array
  const cleanedBreakdowns = breakdowns.filter((b) => !ACTION_BREAKDOWN_KEYS.includes(b));
  if (cleanedBreakdowns.length !== breakdowns.length) {
    console.error(
      "[QueryPlanner] Action breakdowns found in regular breakdowns array!",
      { original: breakdowns, cleaned: cleanedBreakdowns }
    );
  }

  // Always include identifiers based on level
  const identifierFields = getIdentifierFields(level);

  // Convert dimension keys to API fields and include them
  const dimensionFields = request.dimensions ? getDimensionApiFields(request.dimensions) : [];

  const allFields = [...new Set([...identifierFields, ...dimensionFields, ...fields])];

  // Build attribution windows from user settings
  let attributionWindows: string[] | undefined;
  if (request.attribution) {
    const windows: string[] = [request.attribution.clickWindow];
    if (request.attribution.includeViewThrough) {
      windows.push(request.attribution.viewWindow);
    }
    attributionWindows = windows;
  }

  return {
    type,
    fields: allFields,
    breakdowns: cleanedBreakdowns.length > 0 ? cleanedBreakdowns : undefined,
    actionBreakdowns: actionBreakdowns.length > 0 ? actionBreakdowns : undefined,
    level,
    timeRange: request.timeRange,
    datePreset: request.datePreset,
    timeIncrement: request.timeIncrement,
    limit: request.limit,
    attributionWindows,
  };
}

/**
 * Get identifier fields based on level
 */
function getIdentifierFields(level: InsightsLevel): string[] {
  const base = ["date_start", "date_stop", "account_id"];

  switch (level) {
    case "ad":
      return [...base, "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name"];
    case "adset":
      return [...base, "adset_id", "adset_name", "campaign_id", "campaign_name"];
    case "campaign":
      return [...base, "campaign_id", "campaign_name"];
    case "account":
      return [...base, "account_name"];
    default:
      return base;
  }
}

/**
 * Get join keys for merging results
 */
function getJoinKeys(level: InsightsLevel, breakdowns: string[]): string[] {
  const keys: string[] = ["date_start", "date_stop"];

  // Add level-specific ID
  switch (level) {
    case "ad":
      keys.push("ad_id");
      break;
    case "adset":
      keys.push("adset_id");
      break;
    case "campaign":
      keys.push("campaign_id");
      break;
    case "account":
      keys.push("account_id");
      break;
  }

  // Add breakdown fields as join keys
  for (const breakdown of breakdowns) {
    // Creative breakdowns return objects, so use their ID as key
    if (CREATIVE_BREAKDOWNS.includes(breakdown)) {
      // These will be handled specially during merge
      keys.push(breakdown);
    } else {
      keys.push(breakdown);
    }
  }

  return keys;
}

// ============================================
// QUERY EXECUTION HELPERS
// ============================================

/**
 * Build the API URL for a Meta API request
 */
export function buildApiUrl(
  adAccountId: string,
  request: MetaApiRequest,
  apiVersion: string = "v26.0"
): string {
  const baseUrl = `https://graph.facebook.com/${apiVersion}/${adAccountId}/insights`;
  const params = new URLSearchParams();

  // Fields
  params.append("fields", request.fields.join(","));

  // Level
  params.append("level", request.level);

  // Time range or preset
  if (request.timeRange) {
    params.append(
      "time_range",
      JSON.stringify({
        since: request.timeRange.since,
        until: request.timeRange.until,
      })
    );
  } else if (request.datePreset) {
    params.append("date_preset", request.datePreset);
  }

  // Time increment
  if (request.timeIncrement) {
    params.append("time_increment", String(request.timeIncrement));
  }

  // Breakdowns
  if (request.breakdowns && request.breakdowns.length > 0) {
    params.append("breakdowns", request.breakdowns.join(","));
  }

  // Action breakdowns
  if (request.actionBreakdowns && request.actionBreakdowns.length > 0) {
    params.append("action_breakdowns", request.actionBreakdowns.join(","));
  }

  // Limit
  if (request.limit) {
    params.append("limit", String(request.limit));
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Build fetch options for Meta API request
 */
export function buildFetchOptions(accessToken: string): RequestInit {
  return {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  };
}

// ============================================
// RESULT MERGING
// ============================================

/**
 * Get base entity join keys (without breakdowns)
 * These keys identify the entity (ad, adset, campaign, account) + time period
 */
function getBaseEntityKeys(row: Record<string, unknown>): string[] {
  const entityKeys: string[] = [];

  // Time period
  if (row.date_start) entityKeys.push("date_start");
  if (row.date_stop) entityKeys.push("date_stop");

  // Entity identifiers (in order of specificity)
  if (row.ad_id) entityKeys.push("ad_id");
  else if (row.adset_id) entityKeys.push("adset_id");
  else if (row.campaign_id) entityKeys.push("campaign_id");
  else if (row.account_id) entityKeys.push("account_id");

  return entityKeys;
}

/**
 * Merge results from multiple API requests
 *
 * Handles the case where action data (at entity level) needs to be joined
 * with creative breakdown data (at asset level). The action data is "broadcast"
 * to all matching creative asset rows.
 */
export function mergeResults(
  results: Record<string, unknown>[][],
  joinKeys: string[]
): Record<string, unknown>[] {
  if (results.length === 0) return [];
  if (results.length === 1) return results[0];

  logger.debug("meta", "Merge starting", {
    resultSetCount: results.length,
    rowCounts: results.map((r, i) => `Set ${i}: ${r.length} rows`),
    joinKeys,
  });

  // Find the result set with the most rows (usually the one with breakdowns)
  // This will be our "base" for the merge
  let baseIndex = 0;
  let maxRows = results[0].length;

  for (let i = 1; i < results.length; i++) {
    if (results[i].length > maxRows) {
      maxRows = results[i].length;
      baseIndex = i;
    }
  }

  logger.debug("meta", "Merge using base index", { baseIndex, rowCount: maxRows });

  // Create a map for the base result set (with full join keys)
  const mergedMap = new Map<string, Record<string, unknown>>();

  // Index base result set by full join keys
  for (const row of results[baseIndex]) {
    const key = generateJoinKey(row, joinKeys);
    mergedMap.set(key, { ...row });
  }

  // Debug: show sample keys from base
  const baseKeys = Array.from(mergedMap.keys()).slice(0, 3);
  logger.debug("meta", "Merge sample base keys", { baseKeys });

  // Create an entity-level index for "broadcast" joins
  // This maps entity keys (ad_id + date) to all full keys that match
  const entityToFullKeys = new Map<string, string[]>();
  for (const row of results[baseIndex]) {
    const baseEntityKeys = getBaseEntityKeys(row);
    const entityKey = generateJoinKey(row, baseEntityKeys);
    const fullKey = generateJoinKey(row, joinKeys);

    if (!entityToFullKeys.has(entityKey)) {
      entityToFullKeys.set(entityKey, []);
    }
    entityToFullKeys.get(entityKey)!.push(fullKey);
  }

  // Merge other result sets
  let exactMatches = 0;
  let broadcastMatches = 0;
  let noMatches = 0;

  for (let i = 0; i < results.length; i++) {
    if (i === baseIndex) continue;

    // Debug: show sample keys from this result set
    if (results[i].length > 0) {
      const sampleRow = results[i][0];
      const sampleKey = generateJoinKey(sampleRow, joinKeys);
      logger.debug("meta", "Merge result set sample", {
        resultSet: i,
        sampleKey,
        sampleRowKeys: Object.keys(sampleRow).filter(k => joinKeys.includes(k)).map(k => `${k}=${sampleRow[k]}`),
      });
    }

    for (const row of results[i]) {
      const fullKey = generateJoinKey(row, joinKeys);
      const existing = mergedMap.get(fullKey);

      if (existing) {
        // Exact match - merge fields
        exactMatches++;
        Object.assign(existing, row);
      } else {
        // No exact match - log the first few non-matches for debugging
        if (noMatches + broadcastMatches < 3) {
          logger.debug("meta", "Merge no exact match", {
            fullKey,
            rowBreakdownValues: joinKeys.map(k => `${k}=${row[k]}`).join(", "),
          });
        }

        // Check if this row has breakdown values (age, gender, etc.)
        // If it does, we should NOT broadcast - the data should only go to the exact matching row
        const regularBreakdownKeys = ["age", "gender", "country", "region", "dma", "publisher_platform", "platform_position", "device_platform", "impression_device"];
        const rowHasBreakdowns = regularBreakdownKeys.some(k => row[k] !== undefined && row[k] !== "");

        // No exact match - try entity-level match (for action data broadcast)
        const baseEntityKeys = getBaseEntityKeys(row);
        const entityKey = generateJoinKey(row, baseEntityKeys);
        const matchingFullKeys = entityToFullKeys.get(entityKey);

        if (matchingFullKeys && matchingFullKeys.length > 0) {
          // If the row has breakdowns but no exact match, try to find a row with matching breakdowns
          // This handles cases where the breakdown values might be slightly different (whitespace, etc.)
          if (rowHasBreakdowns) {
            // Try to find a matching row by comparing breakdown values more flexibly
            let foundMatch = false;
            for (const matchKey of matchingFullKeys) {
              const targetRow = mergedMap.get(matchKey);
              if (targetRow) {
                // Check if all breakdown values match (with normalization)
                const allBreakdownsMatch = regularBreakdownKeys.every(k => {
                  const rowVal = String(row[k] ?? "").trim().toLowerCase();
                  const targetVal = String(targetRow[k] ?? "").trim().toLowerCase();
                  // Both undefined/empty OR both have the same normalized value
                  return (rowVal === "" && targetVal === "") || rowVal === targetVal;
                });

                if (allBreakdownsMatch) {
                  // Found a match - merge all fields
                  Object.assign(targetRow, row);
                  foundMatch = true;
                  exactMatches++; // Count as exact match since we found the right row
                  break;
                }
              }
            }

            if (!foundMatch) {
              // Row has breakdowns but no matching row found - add as new row
              // This can happen if the action data has breakdowns not present in delivery
              logger.debug("meta", "Merge row has breakdowns but no match found - adding as new row");
              noMatches++;
              mergedMap.set(fullKey, { ...row });
            }
          } else {
            // Row has NO breakdowns - broadcast to all matching entity rows
            // This is the correct behavior for entity-level action data
            broadcastMatches++;
            logger.debug("meta", "Merge broadcasting action data", {
              targetRowCount: matchingFullKeys.length,
              entityKey,
            });
            for (const matchKey of matchingFullKeys) {
              const targetRow = mergedMap.get(matchKey);
              if (targetRow) {
                // Merge action-based fields (these are the fields that come from action requests)
                // We copy all action/conversion related fields to each creative asset row
                for (const [field, value] of Object.entries(row)) {
                  // Skip identifier fields that shouldn't be overwritten
                  if (field.endsWith("_id") || field.endsWith("_name") ||
                      field === "date_start" || field === "date_stop" ||
                      field === "account_currency") {
                    continue;
                  }

                  // Action-based fields to broadcast:
                  // - actions, action_values (main action arrays)
                  // - conversions, conversion_values
                  // - cost_per_action_type, cost_per_conversion
                  // - purchase_roas, website_purchase_roas, mobile_app_purchase_roas
                  // - outbound_clicks, unique_outbound_clicks, outbound_clicks_ctr
                  // - video_*_actions fields
                  // - cost_per_thruplay, cost_per_outbound_click
                  const isActionField =
                    field === "actions" || field === "action_values" ||
                    field === "conversions" || field === "conversion_values" ||
                    field === "cost_per_action_type" || field === "cost_per_conversion" ||
                    field === "purchase_roas" || field === "website_purchase_roas" || field === "mobile_app_purchase_roas" ||
                    field === "outbound_clicks" || field === "unique_outbound_clicks" ||
                    field === "outbound_clicks_ctr" || field === "unique_outbound_clicks_ctr" ||
                    field === "cost_per_outbound_click" || field === "cost_per_unique_outbound_click" ||
                    field === "cost_per_thruplay" ||
                    field.startsWith("video_") && field.endsWith("_actions");

                  if (isActionField) {
                    targetRow[field] = value;
                  }
                }
              }
            }
          }
        } else {
          // No entity match - add as new row
          noMatches++;
          mergedMap.set(fullKey, { ...row });
        }
      }
    }
  }

  logger.debug("meta", "Merge complete", {
    exactMatches,
    broadcastMatches,
    noMatches,
    finalRowCount: mergedMap.size,
  });

  return Array.from(mergedMap.values());
}

/**
 * Generate a join key from a row
 * @param row - The data row
 * @param joinKeys - Keys to use for the join
 * @param includeBreakdowns - If false, only include entity keys (id + date), not breakdown keys
 */
function generateJoinKey(
  row: Record<string, unknown>,
  joinKeys: string[],
  includeBreakdowns: boolean = true
): string {
  const parts: string[] = [];

  // Define which keys are breakdowns (not entity identifiers)
  const breakdownKeys = ["age", "gender", "country", "region", "dma", "publisher_platform", "platform_position", "device_platform", "impression_device"];

  for (const key of joinKeys) {
    // Skip breakdown keys if includeBreakdowns is false
    if (!includeBreakdowns && breakdownKeys.includes(key)) {
      continue;
    }

    const value = row[key];

    // Handle object values (like creative asset breakdowns)
    if (value && typeof value === "object") {
      if ("id" in value) {
        parts.push(String((value as { id: string }).id));
      } else {
        parts.push(JSON.stringify(value));
      }
    } else {
      // Normalize string values (trim whitespace, handle undefined)
      const strValue = String(value ?? "").trim();
      parts.push(strValue);
    }
  }

  return parts.join("|");
}

// ============================================
// QUERY PLAN DISPLAY HELPERS
// ============================================

/**
 * Format a query plan for display
 */
export function formatQueryPlanForDisplay(plan: QueryPlan): string {
  const lines: string[] = [];

  lines.push(`=== Query Plan ===`);
  lines.push(`Requests: ${plan.requests.length}`);
  lines.push(`Calculated Metrics: ${plan.calculatedMetrics.join(", ") || "none"}`);
  lines.push(`Join Keys: ${plan.joinKeys.join(", ")}`);

  if (plan.warnings.length > 0) {
    lines.push(`\nWarnings:`);
    plan.warnings.forEach((w) => lines.push(`  ⚠️ ${w}`));
  }

  if (plan.errors.length > 0) {
    lines.push(`\nErrors:`);
    plan.errors.forEach((e) => lines.push(`  ❌ ${e}`));
  }

  lines.push(`\n--- Requests ---`);

  plan.requests.forEach((req, index) => {
    lines.push(`\nRequest ${index + 1} (${req.type}):`);
    lines.push(`  Fields: ${req.fields.join(", ")}`);
    lines.push(`  Level: ${req.level}`);
    if (req.breakdowns) {
      lines.push(`  Breakdowns: ${req.breakdowns.join(", ")}`);
    }
    if (req.actionBreakdowns) {
      lines.push(`  Action Breakdowns: ${req.actionBreakdowns.join(", ")}`);
    }
    if (req.timeRange) {
      lines.push(`  Time Range: ${req.timeRange.since} to ${req.timeRange.until}`);
    }
    if (req.datePreset) {
      lines.push(`  Date Preset: ${req.datePreset}`);
    }
  });

  return lines.join("\n");
}

/**
 * Get a summary of the query plan
 */
export function getQueryPlanSummary(plan: QueryPlan): {
  requestCount: number;
  hasCalculatedMetrics: boolean;
  isValid: boolean;
  summary: string;
} {
  const isValid = plan.errors.length === 0;
  const hasCalculatedMetrics = plan.calculatedMetrics.length > 0;

  let summary = "";
  if (!isValid) {
    summary = `Invalid query: ${plan.errors[0]}`;
  } else if (plan.requests.length === 1) {
    summary = "Single API request - all metrics compatible";
  } else {
    const types = plan.requests.map((r) => r.type).join(" + ");
    summary = `${plan.requests.length} requests needed (${types})`;
    if (hasCalculatedMetrics) {
      summary += ` + ${plan.calculatedMetrics.length} calculated`;
    }
  }

  return {
    requestCount: plan.requests.length,
    hasCalculatedMetrics,
    isValid,
    summary,
  };
}
