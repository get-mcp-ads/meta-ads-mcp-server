/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// ============================================
// META MARKETING API COMPATIBILITY RULES
// Defines metric/breakdown compatibility matrix
// ============================================

import { InsightsLevel, ValidationResult } from "./types.js";
import { getMetricByKey } from "./metric-catalog.js";
import {
  getBreakdownByKey,
  isBreakdownAvailableAtLevel,
  isValidBreakdownCombination,
} from "./breakdown-catalog.js";

// ============================================
// FIELDS NOT AVAILABLE WITH ANY BREAKDOWN
// ============================================

/**
 * These fields cannot be requested when using any breakdown
 */
export const FIELDS_INCOMPATIBLE_WITH_ALL_BREAKDOWNS: string[] = [
  "app_store_clicks",
  "newsfeed_avg_position",
  "newsfeed_clicks",
  "relevance_score",
  "newsfeed_impressions",
];

// ============================================
// METRIC-SPECIFIC RESTRICTIONS
// ============================================

/**
 * Video metrics incompatible with hourly breakdowns
 */
export const VIDEO_METRICS_NO_HOURLY: string[] = [
  "video_play_actions",
  "video_10_sec_watched_actions",
  "video_15_sec_watched_actions",
  "video_30_sec_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
  "video_avg_time_watched_actions",
  "video_time_watched_actions",
  "video_continuous_2_sec_watched_actions",
  "video_play_curve_actions",
  "video_play_retention_0_to_15s_actions",
  "video_play_retention_20_to_60s_actions",
  "video_play_retention_graph_actions",
];

/**
 * Video metrics incompatible with region breakdown
 */
export const VIDEO_METRICS_NO_REGION: string[] = [
  "video_avg_time_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
];

/**
 * Metrics incompatible with DMA breakdown
 */
export const METRICS_NO_DMA: string[] = [
  "estimated_ad_recall_rate",
  "video_thruplay_watched_actions",
];

/**
 * Unique-count fields that return 0 with hourly breakdowns
 */
export const UNIQUE_FIELDS_RETURN_ZERO_WITH_HOURLY: string[] = [
  "reach",
  "frequency",
  "unique_clicks",
  "unique_ctr",
  "unique_inline_link_clicks",
  "unique_inline_link_click_ctr",
  "unique_outbound_clicks",
  "unique_outbound_clicks_ctr",
  "unique_social_clicks",
  "cost_per_unique_click",
  "cost_per_unique_inline_link_click",
  "cost_per_unique_outbound_click",
];

/**
 * Hourly breakdown keys
 */
export const HOURLY_BREAKDOWNS: string[] = [
  "hourly_stats_aggregated_by_advertiser_time_zone",
  "hourly_stats_aggregated_by_audience_time_zone",
];

// ============================================
// CREATIVE BREAKDOWN RESTRICTIONS
// ============================================

/**
 * Limited metrics supported with creative breakdowns
 */
export const CREATIVE_BREAKDOWN_SUPPORTED_METRICS: string[] = [
  "impressions",
  "clicks",
  "spend",
  "reach",
  "actions",
  "action_values",
];

/**
 * Creative breakdown keys
 */
export const CREATIVE_BREAKDOWNS: string[] = [
  "image_asset",
  "video_asset",
  "body_asset",
  "title_asset",
  "description_asset",
  "call_to_action_asset",
  "link_url_asset",
  "ad_format_asset",
  "media_type",
  "media_format",
  "flexible_format_asset_type",
  "gen_ai_asset_type",
];

// ============================================
// OFFSITE METRIC RESTRICTIONS
// ============================================

/**
 * Breakdowns that block offsite (conversion) metrics entirely
 */
export const BREAKDOWNS_BLOCKING_OFFSITE_METRICS: string[] = [
  "region",
  "dma",
  "hourly_stats_aggregated_by_advertiser_time_zone",
  "hourly_stats_aggregated_by_audience_time_zone",
];

/**
 * Breakdowns that partially block offsite metrics
 * (web metrics returned without breakdown value, mobile metrics blocked)
 */
export const BREAKDOWNS_PARTIAL_OFFSITE_SUPPORT: string[] = [
  "action_device",
  "action_destination",
  "action_target_id",
  "product_id",
  "action_carousel_card_id",
  "action_carousel_card_name",
  "action_canvas_component_name",
];

/**
 * Action-based metrics (require action arrays)
 */
export const ACTION_BASED_METRICS: string[] = [
  "actions",
  "action_values",
  "conversions",
  "conversion_values",
  "cost_per_action_type",
  "cost_per_conversion",
  "purchase_roas",
  "website_purchase_roas",
  "mobile_app_purchase_roas",
  "outbound_clicks",
  "unique_outbound_clicks",
  "outbound_clicks_ctr",
  "unique_outbound_clicks_ctr",
  "cost_per_outbound_click",
  "cost_per_unique_outbound_click",
  "video_play_actions",
  "video_10_sec_watched_actions",
  "video_15_sec_watched_actions",
  "video_30_sec_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
  "video_avg_time_watched_actions",
  "cost_per_thruplay",
];

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Check if a metric is compatible with a specific breakdown
 */
export function isMetricCompatibleWithBreakdown(
  metricKey: string,
  breakdownKey: string
): { compatible: boolean; reason?: string } {
  const metric = getMetricByKey(metricKey);
  const breakdown = getBreakdownByKey(breakdownKey);

  if (!metric) {
    return { compatible: false, reason: `Unknown metric: ${metricKey}` };
  }

  if (!breakdown) {
    return { compatible: false, reason: `Unknown breakdown: ${breakdownKey}` };
  }

  // Check if metric is globally incompatible with breakdowns
  if (FIELDS_INCOMPATIBLE_WITH_ALL_BREAKDOWNS.includes(metricKey)) {
    return {
      compatible: false,
      reason: `${metric.name} cannot be used with any breakdown`,
    };
  }

  // Check hourly breakdown restrictions for video metrics
  if (HOURLY_BREAKDOWNS.includes(breakdownKey)) {
    if (VIDEO_METRICS_NO_HOURLY.includes(metricKey)) {
      return {
        compatible: false,
        reason: `${metric.name} is incompatible with hourly breakdowns`,
      };
    }
    if (UNIQUE_FIELDS_RETURN_ZERO_WITH_HOURLY.includes(metricKey)) {
      return {
        compatible: true,
        reason: `Warning: ${metric.name} will return 0 with hourly breakdowns`,
      };
    }
  }

  // Check region breakdown restrictions
  if (breakdownKey === "region") {
    if (VIDEO_METRICS_NO_REGION.includes(metricKey)) {
      return {
        compatible: false,
        reason: `${metric.name} is incompatible with region breakdown`,
      };
    }
  }

  // Check DMA breakdown restrictions
  if (breakdownKey === "dma") {
    if (METRICS_NO_DMA.includes(metricKey)) {
      return {
        compatible: false,
        reason: `${metric.name} is incompatible with DMA breakdown`,
      };
    }
  }

  // Check creative breakdown restrictions
  if (CREATIVE_BREAKDOWNS.includes(breakdownKey)) {
    if (!CREATIVE_BREAKDOWN_SUPPORTED_METRICS.includes(metricKey)) {
      // For calculated metrics, check if their required fields are supported
      if (metric.type === "calculated" && metric.requiredFields) {
        const unsupportedFields = metric.requiredFields.filter(
          (f) => !CREATIVE_BREAKDOWN_SUPPORTED_METRICS.includes(f)
        );
        if (unsupportedFields.length > 0) {
          return {
            compatible: false,
            reason: `${metric.name} requires fields not supported with creative breakdowns: ${unsupportedFields.join(", ")}`,
          };
        }
      } else {
        return {
          compatible: false,
          reason: `${metric.name} is not supported with creative breakdowns. Only impressions, clicks, spend, reach, actions, action_values are supported.`,
        };
      }
    }
  }

  // Check if breakdown blocks offsite metrics
  if (BREAKDOWNS_BLOCKING_OFFSITE_METRICS.includes(breakdownKey)) {
    // Check if metric is an offsite/conversion metric
    if (
      metric.category === "conversion" ||
      metricKey.includes("conversion") ||
      metricKey.includes("purchase") ||
      metricKey.includes("roas")
    ) {
      return {
        compatible: false,
        reason: `${metric.name} (offsite metric) is not available with ${breakdown.name}`,
      };
    }
  }

  // Check metric's own compatibility list
  if (
    metric.incompatibleBreakdowns &&
    metric.incompatibleBreakdowns.includes(breakdownKey)
  ) {
    return {
      compatible: false,
      reason: `${metric.name} is explicitly incompatible with ${breakdown.name}`,
    };
  }

  return { compatible: true };
}

/**
 * Validate a complete query selection
 */
export function validateQuerySelection(
  metrics: string[],
  breakdowns: string[],
  actionBreakdowns: string[],
  level: InsightsLevel
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each metric against each breakdown
  for (const metricKey of metrics) {
    const metric = getMetricByKey(metricKey);

    // Check for deprecated metrics
    if (metric?.isDeprecated) {
      warnings.push(
        `"${metric.name}" is deprecated and no longer supported by Meta API. It will be skipped.`
      );
      continue; // Skip further checks for deprecated metrics
    }

    // Check against standard breakdowns
    for (const breakdownKey of breakdowns) {
      const result = isMetricCompatibleWithBreakdown(metricKey, breakdownKey);
      if (!result.compatible) {
        errors.push(result.reason!);
      } else if (result.reason) {
        warnings.push(result.reason);
      }
    }

    // Check level restrictions for metrics
    if (metric?.levelRestrictions && !metric.levelRestrictions.includes(level)) {
      errors.push(
        `${metric.name} is only available at ${metric.levelRestrictions.join(", ")} level(s)`
      );
    }
  }

  // Check breakdown level restrictions
  for (const breakdownKey of breakdowns) {
    if (!isBreakdownAvailableAtLevel(breakdownKey, level)) {
      const breakdown = getBreakdownByKey(breakdownKey);
      errors.push(
        `${breakdown?.name || breakdownKey} is only available at ad level`
      );
    }
  }

  // Check if mixing standard breakdowns with action breakdowns inappropriately
  if (breakdowns.length > 0 && actionBreakdowns.length > 0) {
    // Action breakdowns (like action_type) can be used alongside standard breakdowns
    // BUT not with creative breakdowns
    const hasCreativeBreakdown = breakdowns.some((b) =>
      CREATIVE_BREAKDOWNS.includes(b)
    );
    if (hasCreativeBreakdown) {
      errors.push(
        "Cannot combine action_breakdowns with creative breakdowns. Use separate API requests."
      );
    }
  }

  // Check breakdown combination validity
  if (breakdowns.length > 1) {
    if (!isValidBreakdownCombination(breakdowns)) {
      warnings.push(
        `The breakdown combination [${breakdowns.join(", ")}] may not be officially supported. Results may vary.`
      );
    }
  }

  // Check historical data limits
  const breakdownsWithLimits = breakdowns.filter((b) => {
    const bd = getBreakdownByKey(b);
    return bd?.historicalLimit !== undefined;
  });
  if (breakdownsWithLimits.length > 0) {
    const limits = breakdownsWithLimits.map((b) => {
      const bd = getBreakdownByKey(b);
      return `${bd?.name}: ${bd?.historicalLimit} months`;
    });
    warnings.push(
      `Historical data limits apply: ${limits.join(", ")}. Queries beyond these limits may return incomplete data.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Determine if metrics need to be split into separate API calls
 */
export function needsSeparateRequests(
  metrics: string[],
  breakdowns: string[],
  _actionBreakdowns: string[]
): { needsSplit: boolean; reason?: string } {
  // Check if we have both action-based metrics and creative breakdowns
  const hasActionMetrics = metrics.some((m) => ACTION_BASED_METRICS.includes(m));
  const hasCreativeBreakdowns = breakdowns.some((b) =>
    CREATIVE_BREAKDOWNS.includes(b)
  );

  if (hasActionMetrics && hasCreativeBreakdowns) {
    return {
      needsSplit: true,
      reason:
        "Action-based metrics cannot be combined with creative breakdowns in a single request",
    };
  }

  // Check if we have calculated metrics that need different base metrics
  const hasConversionMetrics = metrics.some((m) => {
    const metric = getMetricByKey(m);
    return metric?.category === "conversion";
  });

  // If we have breakdowns that block offsite metrics but we need conversions
  if (hasConversionMetrics) {
    const blockingBreakdowns = breakdowns.filter((b) =>
      BREAKDOWNS_BLOCKING_OFFSITE_METRICS.includes(b)
    );
    if (blockingBreakdowns.length > 0) {
      return {
        needsSplit: true,
        reason: `Conversion metrics cannot be retrieved with ${blockingBreakdowns.join(", ")} breakdown(s). Need separate requests.`,
      };
    }
  }

  return { needsSplit: false };
}

/**
 * Get list of metrics that must be fetched separately
 * Returns groups of metrics that can be fetched together
 */
export function groupMetricsByCompatibility(
  metrics: string[],
  breakdowns: string[]
): { group: string[]; breakdownsAllowed: string[]; reason?: string }[] {
  const groups: {
    group: string[];
    breakdownsAllowed: string[];
    reason?: string;
  }[] = [];

  // Separate action-based metrics from delivery metrics when creative breakdowns are used
  const hasCreativeBreakdowns = breakdowns.some((b) =>
    CREATIVE_BREAKDOWNS.includes(b)
  );

  if (hasCreativeBreakdowns) {
    const supportedMetrics = metrics.filter((m) =>
      CREATIVE_BREAKDOWN_SUPPORTED_METRICS.includes(m)
    );
    const unsupportedMetrics = metrics.filter(
      (m) => !CREATIVE_BREAKDOWN_SUPPORTED_METRICS.includes(m)
    );

    if (supportedMetrics.length > 0) {
      groups.push({
        group: supportedMetrics,
        breakdownsAllowed: breakdowns,
        reason: "Metrics compatible with creative breakdowns",
      });
    }

    if (unsupportedMetrics.length > 0) {
      // These need to be fetched without creative breakdowns
      const nonCreativeBreakdowns = breakdowns.filter(
        (b) => !CREATIVE_BREAKDOWNS.includes(b)
      );
      groups.push({
        group: unsupportedMetrics,
        breakdownsAllowed: nonCreativeBreakdowns,
        reason: "Metrics incompatible with creative breakdowns - fetched separately",
      });
    }
  } else {
    // No creative breakdowns - check for other incompatibilities
    const compatibleWithAll: string[] = [];
    const needsSeparate: { metric: string; incompatibleWith: string[] }[] = [];

    for (const metric of metrics) {
      const incompatibleBreakdowns: string[] = [];

      for (const breakdown of breakdowns) {
        const result = isMetricCompatibleWithBreakdown(metric, breakdown);
        if (!result.compatible) {
          incompatibleBreakdowns.push(breakdown);
        }
      }

      if (incompatibleBreakdowns.length === 0) {
        compatibleWithAll.push(metric);
      } else {
        needsSeparate.push({ metric, incompatibleWith: incompatibleBreakdowns });
      }
    }

    if (compatibleWithAll.length > 0) {
      groups.push({
        group: compatibleWithAll,
        breakdownsAllowed: breakdowns,
        reason: "Fully compatible metrics",
      });
    }

    // Group metrics by their incompatibilities
    for (const item of needsSeparate) {
      const allowedBreakdowns = breakdowns.filter(
        (b) => !item.incompatibleWith.includes(b)
      );
      groups.push({
        group: [item.metric],
        breakdownsAllowed: allowedBreakdowns,
        reason: `Incompatible with: ${item.incompatibleWith.join(", ")}`,
      });
    }
  }

  return groups;
}

/**
 * Get the API field names for a list of metrics
 * Some metrics have different API field names than their keys
 *
 * IMPORTANT: This function recursively resolves metric keys to API fields.
 * Calculated metrics have `requiredFields` which may contain other metric keys
 * that need to be resolved to their API field names.
 */
export function getApiFieldsForMetrics(metricKeys: string[]): string[] {
  const fields: string[] = [];

  // Raw API field names that should be passed through directly
  // These are valid Meta API field names, not metric keys
  const RAW_API_FIELDS = [
    "actions",
    "action_values",
    "cost_per_action_type",
    "conversions",
    "conversion_values",
    // Video metrics API fields
    "video_play_actions",
    "video_p25_watched_actions",
    "video_p50_watched_actions",
    "video_p75_watched_actions",
    "video_p95_watched_actions",
    "video_p100_watched_actions",
    "video_thruplay_watched_actions",
    "video_time_watched_actions",
    "video_avg_time_watched_actions",
    "video_30_sec_watched_actions",
    "video_15_sec_watched_actions",
  ];

  // Helper function to resolve a single metric key to API field(s)
  // Uses a Set to track visited keys and prevent infinite recursion
  const resolveMetricKey = (key: string, visited: Set<string>): string[] => {
    // Prevent infinite recursion
    if (visited.has(key)) return [];
    visited.add(key);

    // If it's a raw API field name, return it directly
    if (RAW_API_FIELDS.includes(key)) {
      return [key];
    }

    const metric = getMetricByKey(key);
    if (!metric) {
      // Unknown key - might be a raw API field we didn't list, return as-is
      return [key];
    }

    if (metric.type === "calculated" && metric.requiredFields) {
      // For calculated metrics, recursively resolve their required fields
      // This handles cases where requiredFields contains metric keys (not API fields)
      const resolvedFields: string[] = [];
      for (const reqField of metric.requiredFields) {
        resolvedFields.push(...resolveMetricKey(reqField, visited));
      }
      return resolvedFields;
    } else {
      // For native metrics, use apiField if specified, otherwise use key
      return [metric.apiField || key];
    }
  };

  // Process all metric keys
  for (const key of metricKeys) {
    fields.push(...resolveMetricKey(key, new Set()));
  }

  // Remove duplicates
  return [...new Set(fields)];
}

/**
 * Check if any metrics require action_breakdowns
 */
export function metricsRequireActionBreakdowns(metrics: string[]): boolean {
  return metrics.some((m) => {
    const metric = getMetricByKey(m);
    // Action-based metrics benefit from action_type breakdown
    return (
      ACTION_BASED_METRICS.includes(m) ||
      metric?.actionType !== undefined ||
      metric?.category === "conversion"
    );
  });
}

/**
 * Check if a single metric is action-based (needs actions/action_values fields)
 * This handles both direct action fields and metrics that extract from action arrays
 */
export function isActionBasedMetric(metricKey: string): boolean {
  // Direct action-based metrics
  if (ACTION_BASED_METRICS.includes(metricKey)) {
    return true;
  }

  // Check if metric extracts from action arrays (has actionType defined)
  const metric = getMetricByKey(metricKey);
  if (!metric) return false;

  // Metrics that have actionType are extracted from actions/action_values arrays
  if (metric.actionType !== undefined) {
    return true;
  }

  // Metrics that use actions, action_values, or cost_per_action_type as their API field
  if (
    metric.apiField === "actions" ||
    metric.apiField === "action_values" ||
    metric.apiField === "cost_per_action_type"
  ) {
    return true;
  }

  return false;
}
