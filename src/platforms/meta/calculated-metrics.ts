/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// ============================================
// DERIVED METRICS
// Client-side metric calculations from raw API data
// ============================================

import {
  InsightRow,
  AdsActionStats,
  DerivedMetrics,
  AttributionSettings,
  AttributionDisplayMode,
  ATTRIBUTION_PRESETS,
} from "./types.js";
import { logger } from "../../core/logger.js";

// ============================================
// ACTION EXTRACTION UTILITIES
// ============================================

/**
 * Extract a specific action value from the actions array
 * @param actions - Array of AdsActionStats from API response
 * @param actionType - The action_type to find (e.g., "offsite_conversion.fb_pixel_purchase")
 * @returns The numeric value or 0 if not found
 */
/**
 * Extract action value from actions array
 * @param actions - Array of AdsActionStats
 * @param actionTypes - Single action_type string or array of action_types to try in order
 * @returns The value of the first matching action, or 0 if not found
 */
export function getActionValue(
  actions: AdsActionStats[] | undefined,
  actionTypes: string | string[]
): number {
  if (!actions || !Array.isArray(actions)) return 0;

  // Normalize to array
  const types = Array.isArray(actionTypes) ? actionTypes : [actionTypes];

  // Try each action type in order
  for (const actionType of types) {
    const action = actions.find((a) => a.action_type === actionType);
    if (action) {
      return parseFloat(action.value);
    }
  }

  return 0;
}

/**
 * Extract action value with specific attribution window
 * @param actions - Array of AdsActionStats
 * @param actionTypes - Single action_type or array of action_types to try in order
 * @param window - Attribution window: "1d_click", "7d_click", "28d_click", "1d_view", "1d_ev"
 */
export function getActionValueWithWindow(
  actions: AdsActionStats[] | undefined,
  actionTypes: string | string[],
  window: "1d_click" | "7d_click" | "28d_click" | "1d_view" | "1d_ev"
): number {
  if (!actions || !Array.isArray(actions)) return 0;

  // Normalize to array
  const types = Array.isArray(actionTypes) ? actionTypes : [actionTypes];

  for (const actionType of types) {
    const action = actions.find((a) => a.action_type === actionType);
    if (action && action[window]) {
      return parseFloat(action[window]!);
    }
  }

  return 0;
}

/**
 * Get all action values for a specific action type
 */
export function getActionWithAllWindows(
  actions: AdsActionStats[] | undefined,
  actionTypes: string | string[]
): {
  total: number;
  "1d_click": number;
  "7d_click": number;
  "28d_click": number;
  "1d_view": number;
  "1d_ev": number;
} {
  const defaultValue = {
    total: 0,
    "1d_click": 0,
    "7d_click": 0,
    "28d_click": 0,
    "1d_view": 0,
    "1d_ev": 0,
  };

  if (!actions || !Array.isArray(actions)) return defaultValue;

  // Normalize to array
  const types = Array.isArray(actionTypes) ? actionTypes : [actionTypes];

  for (const actionType of types) {
    const action = actions.find((a) => a.action_type === actionType);
    if (action) {
      return {
        total: parseFloat(action.value) || 0,
        "1d_click": parseFloat(action["1d_click"] || "0"),
        "7d_click": parseFloat(action["7d_click"] || "0"),
        "28d_click": parseFloat(action["28d_click"] || "0"),
        "1d_view": parseFloat(action["1d_view"] || "0"),
        "1d_ev": parseFloat(action["1d_ev"] || "0"),
      };
    }
  }

  return defaultValue;
}

/**
 * Get value from action_values array (for monetary values)
 */
export function getActionMonetaryValue(
  actionValues: AdsActionStats[] | undefined,
  actionTypes: string | string[]
): number {
  return getActionValue(actionValues, actionTypes);
}

/**
 * Sum all values from an actions array
 */
export function sumAllActions(actions: AdsActionStats[] | undefined): number {
  if (!actions || !Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => sum + parseFloat(action.value), 0);
}

// ============================================
// ATTRIBUTION WINDOW EXTRACTION
// ============================================

/**
 * Extract action value with custom attribution settings
 * Supports combining click + view attribution, or single window
 */
export function getActionValueWithAttribution(
  actions: AdsActionStats[] | undefined,
  actionTypes: string | string[],
  attribution: AttributionSettings
): number {
  if (!actions || !Array.isArray(actions)) return 0;

  // Normalize to array
  const types = Array.isArray(actionTypes) ? actionTypes : [actionTypes];

  // Try each action type in order
  for (const actionType of types) {
    const action = actions.find((a) => a.action_type === actionType);
    if (action) {
      const clickValue = parseFloat(action[attribution.clickWindow] || "0");
      const viewValue = attribution.includeViewThrough
        ? parseFloat(action[attribution.viewWindow] || "0")
        : 0;
      return clickValue + viewValue;
    }
  }

  return 0;
}

/**
 * Extract action values split by click and view attribution
 * Returns separate values for click, view, and total
 */
export function getActionValuesSplit(
  actions: AdsActionStats[] | undefined,
  actionTypes: string | string[],
  attribution: AttributionSettings
): { click: number; view: number; total: number } {
  if (!actions || !Array.isArray(actions)) {
    return { click: 0, view: 0, total: 0 };
  }

  // Normalize to array
  const types = Array.isArray(actionTypes) ? actionTypes : [actionTypes];

  // Try each action type in order
  for (const actionType of types) {
    const action = actions.find((a) => a.action_type === actionType);
    if (action) {
      const click = parseFloat(action[attribution.clickWindow] || "0");
      const view = parseFloat(action[attribution.viewWindow] || "0");

      return {
        click,
        view,
        total: click + view,
      };
    }
  }

  return { click: 0, view: 0, total: 0 };
}

/**
 * Get monetary value with custom attribution settings
 */
export function getActionMonetaryValueWithAttribution(
  actionValues: AdsActionStats[] | undefined,
  actionTypes: string | string[],
  attribution: AttributionSettings
): number {
  return getActionValueWithAttribution(actionValues, actionTypes, attribution);
}

/**
 * Get monetary values split by attribution
 */
export function getActionMonetaryValuesSplit(
  actionValues: AdsActionStats[] | undefined,
  actionTypes: string | string[],
  attribution: AttributionSettings
): { click: number; view: number; total: number } {
  return getActionValuesSplit(actionValues, actionTypes, attribution);
}

/**
 * Default attribution settings (7d click + 1d view)
 */
export const DEFAULT_ATTRIBUTION: AttributionSettings = ATTRIBUTION_PRESETS.default;

// ============================================
// VIDEO METRIC UTILITIES
// ============================================

/**
 * Extract video metric value from video metrics array
 * Video metrics like video_p25_watched_actions return AdsActionStats[] arrays
 * Format: [{ action_type: "video_view", value: "1234" }]
 *
 * This function handles multiple possible formats:
 * 1. Standard format with action_type="video_view"
 * 2. Array with just the first item (no specific action_type)
 * 3. Empty array or undefined
 */
export function getVideoMetricValue(
  videoActions: AdsActionStats[] | undefined
): number {
  if (!videoActions || !Array.isArray(videoActions) || videoActions.length === 0) {
    return 0;
  }

  // First, try to find the video_view action type (standard format)
  const videoAction = videoActions.find((a) => a.action_type === "video_view");
  if (videoAction && videoAction.value) {
    return parseFloat(videoAction.value) || 0;
  }

  // Fallback: if no video_view action_type, try the first item with a value
  // Some API responses may not include action_type for video metrics
  if (videoActions[0] && videoActions[0].value) {
    return parseFloat(videoActions[0].value) || 0;
  }

  return 0;
}

/**
 * Calculate video retention metrics
 */
export function calculateVideoRetention(row: InsightRow): {
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p100: number;
  avgWatchTime: number;
  retentionRate: number; // p100 / p25 * 100
  thruPlay: number;
} {
  const p25 = getVideoMetricValue(row.video_p25_watched_actions);
  const p50 = getVideoMetricValue(row.video_p50_watched_actions);
  const p75 = getVideoMetricValue(row.video_p75_watched_actions);
  const p95 = getVideoMetricValue(row.video_p95_watched_actions);
  const p100 = getVideoMetricValue(row.video_p100_watched_actions);
  const avgWatchTime = getVideoMetricValue(row.video_avg_time_watched_actions);
  const thruPlay = getVideoMetricValue(row.video_thruplay_watched_actions);

  return {
    p25,
    p50,
    p75,
    p95,
    p100,
    avgWatchTime,
    retentionRate: p25 > 0 ? (p100 / p25) * 100 : 0,
    thruPlay,
  };
}

// ============================================
// SAFE NUMBER PARSING
// ============================================

/**
 * Safely parse a numeric string
 */
function safeParseFloat(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Safely parse an integer string
 */
function safeParseInt(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}

// ============================================
// DERIVED METRICS
// ============================================

/**
 * Calculate all derived metrics from a single row
 */
export function calculateDerivedMetrics(row: InsightRow): DerivedMetrics {
  // Extract base values
  const impressions = safeParseInt(row.impressions);
  const clicks = safeParseInt(row.clicks);
  const spend = safeParseFloat(row.spend);
  const linkClicks = getActionValue(row.actions, ["link_click"]);
  const videoViews3s = getActionValue(row.actions, ["video_view"]);

  // General funnel metrics prefer omni totals, with a website fallback.
  const addToCart = getActionValue(row.actions, ["omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]);
  const purchases = getActionValue(row.actions, ["omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
  const purchaseValue = getActionMonetaryValue(row.action_values, ["omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
  // Explicit website metrics must not fall back to purchases from other channels.
  const websitePurchases = getActionValue(row.actions, "offsite_conversion.fb_pixel_purchase");
  const websitePurchaseValue = getActionMonetaryValue(row.action_values, "offsite_conversion.fb_pixel_purchase");
  const viewContent = getActionValue(row.actions, ["omni_view_content", "offsite_conversion.fb_pixel_view_content"]);
  const initiateCheckout = getActionValue(row.actions, ["omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]);

  // Shop purchases (on-platform)
  const shopPurchases = getActionValue(row.actions, ["onsite_conversion.purchase"]);
  const shopPurchaseValue = getActionMonetaryValue(row.action_values, ["onsite_conversion.purchase"]);

  // Leads & subscriptions (try omni_ first)
  const leads = getActionValue(row.actions, ["omni_lead", "offsite_conversion.fb_pixel_lead"]);
  const leadsValue = getActionMonetaryValue(row.action_values, ["omni_lead", "offsite_conversion.fb_pixel_lead"]);
  const subscriptions = getActionValue(row.actions, ["offsite_conversion.fb_pixel_subscribe"]);
  const subscriptionValue = getActionMonetaryValue(row.action_values, ["offsite_conversion.fb_pixel_subscribe"]);
  const registrations = getActionValue(row.actions, ["omni_complete_registration", "offsite_conversion.fb_pixel_complete_registration"]);
  const contacts = getActionValue(row.actions, ["offsite_conversion.fb_pixel_contact"]);
  const findLocations = getActionValue(row.actions, ["offsite_conversion.fb_pixel_find_location"]);
  const appointments = getActionValue(row.actions, ["offsite_conversion.fb_pixel_schedule"]);
  const trials = getActionValue(row.actions, ["offsite_conversion.fb_pixel_start_trial"]);

  // App metrics
  const appInstalls = getActionValue(row.actions, ["omni_app_install", "mobile_app_install"]);
  const appPurchases = getActionValue(row.actions, ["app_custom_event.fb_mobile_purchase"]);
  const appPurchaseValue = getActionMonetaryValue(row.action_values, "app_custom_event.fb_mobile_purchase");
  const appTrials = getActionValue(row.actions, ["app_custom_event.fb_mobile_start_trial"]);
  const appRegistrations = getActionValue(row.actions, ["app_custom_event.fb_mobile_complete_registration"]);
  const achievements = getActionValue(row.actions, ["app_custom_event.fb_mobile_achievement_unlocked"]);

  // Outbound clicks - extract from array if needed
  let outboundClicks = 0;
  if (row.outbound_clicks && Array.isArray(row.outbound_clicks)) {
    const outboundAction = (row.outbound_clicks as AdsActionStats[]).find(
      (a) => a.action_type === "outbound_click"
    );
    outboundClicks = outboundAction ? parseFloat(outboundAction.value) : 0;
  }

  // Video retention
  const videoPlays = getVideoMetricValue(row.video_play_actions);
  const video_p25 = getVideoMetricValue(row.video_p25_watched_actions);
  const video_p50 = getVideoMetricValue(row.video_p50_watched_actions);
  const video_p75 = getVideoMetricValue(row.video_p75_watched_actions);
  const video_p95 = getVideoMetricValue(row.video_p95_watched_actions);
  const video_p100 = getVideoMetricValue(row.video_p100_watched_actions);
  const video15s = getVideoMetricValue(row.video_15_sec_watched_actions);
  const thruPlay = getVideoMetricValue(row.video_thruplay_watched_actions);

  // Total Watch Time: Use API value if available, otherwise calculate fallback
  // Fallback: Total Watch Time ≈ Average Watch Time × Video Views (3s)
  let totalWatchTime = getVideoMetricValue(row.video_time_watched_actions);
  if (totalWatchTime === 0) {
    const avgWatchTime = getVideoMetricValue(row.video_avg_time_watched_actions);
    if (avgWatchTime > 0 && videoViews3s > 0) {
      totalWatchTime = avgWatchTime * videoViews3s;
    }
  }

  // Additional funnel metrics needed for cost_per calculations
  const landingPageViews = getActionValue(row.actions, ["landing_page_view"]);
  const messagingConversations = getActionValue(row.actions, ["onsite_conversion.messaging_conversation_started_7d"]);

  // Engagement
  const engagement = safeParseInt(row.inline_post_engagement);
  const pageLikes = getActionValue(row.actions, "like"); // PAGE likes (following the page)
  const postReactions = getActionValue(row.actions, "post_reaction"); // POST reactions (likes, love, etc. on the ad)
  const comments = getActionValue(row.actions, "comment");
  const shares = getActionValue(row.actions, "post");

  return {
    // ===== ORIGINAL METRICS =====
    // Video creative metrics
    hookRate: impressions > 0 ? (videoViews3s / impressions) * 100 : undefined,
    thumbstopRate: impressions > 0 ? (videoPlays / impressions) * 100 : undefined,
    // Match the published catalog definition and its requested dependencies.
    holdRate: impressions > 0 ? (thruPlay / impressions) * 100 : undefined,
    completionRate: video_p25 > 0 ? (video_p100 / video_p25) * 100 : undefined,

    // E-commerce funnel metrics
    clickToAtcRatio: linkClicks > 0 ? (addToCart / linkClicks) * 100 : undefined,
    atcToPurchaseRatio: addToCart > 0 ? (purchases / addToCart) * 100 : undefined,
    clickToPurchaseRatio: linkClicks > 0 ? (purchases / linkClicks) * 100 : undefined,
    aov: purchases > 0 ? purchaseValue / purchases : undefined,
    costPerAtc: addToCart > 0 ? spend / addToCart : undefined,

    // ===== COST PER METRICS (calculated as spend / count) =====
    // These are calculated client-side for reliability since Meta's cost_per_action_type
    // array may not always contain all action types
    cost_per_page_like: pageLikes > 0 ? spend / pageLikes : undefined,
    cost_per_messaging_conversation: messagingConversations > 0 ? spend / messagingConversations : undefined,
    cost_per_lead: leads > 0 ? spend / leads : undefined,
    cost_per_purchase: purchases > 0 ? spend / purchases : undefined,
    cost_per_add_to_cart: addToCart > 0 ? spend / addToCart : undefined,
    cost_per_initiate_checkout: initiateCheckout > 0 ? spend / initiateCheckout : undefined,
    cost_per_app_install: appInstalls > 0 ? spend / appInstalls : undefined,
    cost_per_landing_page_view: landingPageViews > 0 ? spend / landingPageViews : undefined,
    cost_per_3s_video_view: videoViews3s > 0 ? spend / videoViews3s : undefined,

    // Engagement
    engagementRate: impressions > 0 ? (engagement / impressions) * 100 : undefined,

    // ===== NEW METRICS FROM COMPETITOR ANALYSIS =====

    // Share/Percentage metrics (Note: requires total context - placeholder calculation)
    // These metrics need access to the total dataset to calculate shares
    // For single row, we return undefined and handle in aggregate functions
    spendShare: undefined, // Calculated at aggregate level
    purchaseValueShare: undefined, // Calculated at aggregate level

    // CTR variants
    outboundCtr: impressions > 0 ? (outboundClicks / impressions) * 100 : undefined,

    // ROAS variants
    subscriptionRoas: spend > 0 && Array.isArray(row.action_values) ? subscriptionValue / spend : undefined,
    leadsRoas: spend > 0 && Array.isArray(row.action_values) ? leadsValue / spend : undefined,

    // Per 1,000 impressions metrics
    purchasesPerMille: impressions > 0 ? (purchases / impressions) * 1000 : undefined,
    revenuePerMille: impressions > 0 ? (purchaseValue / impressions) * 1000 : undefined,
    installsPerMille: impressions > 0 ? (appInstalls / impressions) * 1000 : undefined,
    leadsPerMille: impressions > 0 ? (leads / impressions) * 1000 : undefined,

    // Engagement rate variants
    impressionsToLeadsRatio: impressions > 0 ? (leads / impressions) * 100 : undefined,
    likeRate: impressions > 0 ? (postReactions / impressions) * 100 : undefined, // Uses POST reactions, not page likes
    commentRate: impressions > 0 ? (comments / impressions) * 100 : undefined,
    postShareRatio: impressions > 0 ? (shares / impressions) * 100 : undefined,
    postEngagementsExclVideo: engagement > 0 && videoViews3s > 0
      ? Math.max(0, engagement - videoViews3s)
      : engagement,
    postEngagementRateExclVideo: impressions > 0
      ? (Math.max(0, engagement - videoViews3s) / impressions) * 100
      : undefined,

    // Video retention metrics
    video15sTo3sRetention: videoViews3s > 0 ? (video15s / videoViews3s) * 100 : undefined,
    // ThruPlay CTR = percentage of impressions that resulted in a ThruPlay
    // NOT linkClicks/thruPlay which can exceed 100%!
    thruplayCtr: impressions > 0 ? (thruPlay / impressions) * 100 : undefined,
    firstFrameRetention: impressions > 0 ? (videoPlays / impressions) * 100 : undefined, // Same as thumbstopRate
    thumbstopClickRate: videoPlays > 0 ? (linkClicks / videoPlays) * 100 : undefined,
    costPerMinuteViewed: totalWatchTime > 0 ? spend / (totalWatchTime / 60) : undefined,

    // Video completion rate variants (per impression)
    videoP25Rate: impressions > 0 ? (video_p25 / impressions) * 100 : undefined,
    videoP50Rate: impressions > 0 ? (video_p50 / impressions) * 100 : undefined,
    videoP75Rate: impressions > 0 ? (video_p75 / impressions) * 100 : undefined,
    videoP95Rate: impressions > 0 ? (video_p95 / impressions) * 100 : undefined,
    videoP100Rate: impressions > 0 ? (video_p100 / impressions) * 100 : undefined,

    // Video drop-off metrics
    dropOffP25ToP50: video_p25 > 0 ? (1 - video_p50 / video_p25) * 100 : undefined,
    dropOffP50ToP75: video_p50 > 0 ? (1 - video_p75 / video_p50) * 100 : undefined,
    dropOffP75ToP95: video_p75 > 0 ? (1 - video_p95 / video_p75) * 100 : undefined,
    dropOffP75ToP100: video_p75 > 0 ? (1 - video_p100 / video_p75) * 100 : undefined,
    dropOffP95ToP100: video_p95 > 0 ? (1 - video_p100 / video_p95) * 100 : undefined,
    sustainRate: video_p25 > 0 ? (video_p95 / video_p25) * 100 : undefined,

    // Click quality & funnel metrics
    clickQuality: clicks > 0 ? (purchases / clicks) * 100 : undefined,
    averageLeadsValue: leads > 0 ? leadsValue / leads : undefined,

    // Click to conversion ratios
    clickToAppInstallRatio: linkClicks > 0 ? (appInstalls / linkClicks) * 100 : undefined,
    clickToLeadsRatio: linkClicks > 0 ? (leads / linkClicks) * 100 : undefined,
    clickToSubscriptionsRatio: linkClicks > 0 ? (subscriptions / linkClicks) * 100 : undefined,
    clickToRegistrationsRatio: linkClicks > 0 ? (registrations / linkClicks) * 100 : undefined,
    clickToTrialStartedRatio: linkClicks > 0 ? (trials / linkClicks) * 100 : undefined,
    leadsToSubscriptionsRatio: leads > 0 ? (subscriptions / leads) * 100 : undefined,
    clickToContactRatio: linkClicks > 0 ? (contacts / linkClicks) * 100 : undefined,
    clickToFindLocationRatio: linkClicks > 0 ? (findLocations / linkClicks) * 100 : undefined,
    clickToAppointmentsRatio: linkClicks > 0 ? (appointments / linkClicks) * 100 : undefined,
    clickToInitiateCheckoutRatio: linkClicks > 0 ? (initiateCheckout / linkClicks) * 100 : undefined,
    clickToWebsitePurchaseRatio: linkClicks > 0 ? (websitePurchases / linkClicks) * 100 : undefined,

    // App funnel metrics
    installToTrialRate: appInstalls > 0 ? (appTrials / appInstalls) * 100 : undefined,
    installToPurchaseRatio: appInstalls > 0 ? (appPurchases / appInstalls) * 100 : undefined,
    installToRegistrationRate: appInstalls > 0 ? (appRegistrations / appInstalls) * 100 : undefined,
    registrationToAchievementRate: appRegistrations > 0 ? (achievements / appRegistrations) * 100 : undefined,
    achievementToPurchaseRate: achievements > 0 ? (appPurchases / achievements) * 100 : undefined,

    // E-commerce funnel metrics
    viewContentRatio: impressions > 0 ? (viewContent / impressions) * 100 : undefined,
    viewContentToAtcRatio: viewContent > 0 ? (addToCart / viewContent) * 100 : undefined,
    checkoutToPurchaseRatio: initiateCheckout > 0 ? (purchases / initiateCheckout) * 100 : undefined,

    // AOV variants
    aovWebsite: websitePurchases > 0 ? websitePurchaseValue / websitePurchases : undefined,
    aovShop: shopPurchases > 0 ? shopPurchaseValue / shopPurchases : undefined,
    aovApp: appPurchases > 0 ? appPurchaseValue / appPurchases : undefined,
  };
}

/**
 * Calculate a single derived metric
 */
export function calculateSingleMetric(
  row: InsightRow,
  metricKey: string
): number | undefined {
  const metrics = calculateDerivedMetrics(row);
  return metrics[metricKey as keyof DerivedMetrics];
}

/**
 * Enrich data with calculated metrics
 */
export function enrichWithCalculatedMetrics(
  data: InsightRow[],
  calculatedMetricKeys: string[]
): (InsightRow & Partial<DerivedMetrics>)[] {
  if (calculatedMetricKeys.length === 0) {
    return data;
  }

  return data.map((row) => {
    const calculated = calculateDerivedMetrics(row);
    const enriched: InsightRow & Partial<DerivedMetrics> = { ...row };

    for (const key of calculatedMetricKeys) {
      const value = calculated[key as keyof DerivedMetrics];
      if (value !== undefined) {
        (enriched as Record<string, unknown>)[key] = value;
      }
    }

    return enriched;
  });
}

/**
 * Calculate share metrics (spendShare, purchaseValueShare) for a dataset
 * These metrics require the total dataset to calculate percentages
 * @param data - Array of InsightRow data
 * @returns Data enriched with share metrics
 */
export function calculateShareMetrics(
  data: (InsightRow & Partial<DerivedMetrics>)[]
): (InsightRow & Partial<DerivedMetrics>)[] {
  if (data.length === 0) return data;

  // Calculate totals
  let totalSpend = 0;
  let totalPurchaseValue = 0;

  for (const row of data) {
    totalSpend += parseFloat(row.spend || "0");
    totalPurchaseValue += getActionMonetaryValue(
      row.action_values,
      "offsite_conversion.fb_pixel_purchase"
    );
  }

  // Calculate share for each row
  return data.map((row) => {
    const rowSpend = parseFloat(row.spend || "0");
    const rowPurchaseValue = getActionMonetaryValue(
      row.action_values,
      "offsite_conversion.fb_pixel_purchase"
    );

    return {
      ...row,
      spendShare: totalSpend > 0 ? (rowSpend / totalSpend) * 100 : undefined,
      purchaseValueShare: totalPurchaseValue > 0
        ? (rowPurchaseValue / totalPurchaseValue) * 100
        : undefined,
    };
  });
}

/**
 * Full enrichment with all calculated metrics including share metrics
 * @param data - Array of InsightRow data
 * @param calculatedMetricKeys - List of calculated metric keys to include
 * @param includeShareMetrics - Whether to calculate share metrics (requires full dataset)
 * @returns Fully enriched data
 */
export function enrichWithAllCalculatedMetrics(
  data: InsightRow[],
  calculatedMetricKeys: string[],
  includeShareMetrics: boolean = true
): (InsightRow & Partial<DerivedMetrics>)[] {
  // First apply basic calculated metrics
  let enriched = enrichWithCalculatedMetrics(data, calculatedMetricKeys);

  // Then apply share metrics if requested
  if (includeShareMetrics && (calculatedMetricKeys.includes("spendShare") || calculatedMetricKeys.includes("purchaseValueShare"))) {
    enriched = calculateShareMetrics(enriched);
  }

  return enriched;
}

// ============================================
// E-COMMERCE FUNNEL ANALYSIS
// ============================================

/**
 * Calculate complete e-commerce funnel from row data
 */
export function calculateEcommerceFunnel(row: InsightRow): {
  impressions: number;
  clicks: number;
  landingPageViews: number;
  contentViews: number;
  addToCart: number;
  initiateCheckout: number;
  purchases: number;
  revenue: number;
  // Conversion rates
  ctr: number;
  landingPageRate: number;
  viewToCartRate: number;
  cartToCheckoutRate: number;
  checkoutToPurchaseRate: number;
  overallConversionRate: number;
  // Costs
  cpc: number;
  costPerLanding: number;
  costPerView: number;
  costPerAtc: number;
  costPerCheckout: number;
  costPerPurchase: number;
  // ROAS
  roas: number;
  aov: number;
} {
  const impressions = safeParseInt(row.impressions);
  const clicks = safeParseInt(row.clicks);
  const spend = safeParseFloat(row.spend);

  const landingPageViews = getActionValue(row.actions, "landing_page_view");
  const contentViews = getActionValue(
    row.actions,
    "offsite_conversion.fb_pixel_view_content"
  );
  const addToCart = getActionValue(
    row.actions,
    "offsite_conversion.fb_pixel_add_to_cart"
  );
  const initiateCheckout = getActionValue(
    row.actions,
    "offsite_conversion.fb_pixel_initiate_checkout"
  );
  const purchases = getActionValue(
    row.actions,
    "offsite_conversion.fb_pixel_purchase"
  );
  const revenue = getActionMonetaryValue(
    row.action_values,
    "offsite_conversion.fb_pixel_purchase"
  );

  return {
    // Absolute numbers
    impressions,
    clicks,
    landingPageViews,
    contentViews,
    addToCart,
    initiateCheckout,
    purchases,
    revenue,

    // Conversion rates
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    landingPageRate: clicks > 0 ? (landingPageViews / clicks) * 100 : 0,
    viewToCartRate: contentViews > 0 ? (addToCart / contentViews) * 100 : 0,
    cartToCheckoutRate: addToCart > 0 ? (initiateCheckout / addToCart) * 100 : 0,
    checkoutToPurchaseRate:
      initiateCheckout > 0 ? (purchases / initiateCheckout) * 100 : 0,
    overallConversionRate: clicks > 0 ? (purchases / clicks) * 100 : 0,

    // Cost metrics
    cpc: clicks > 0 ? spend / clicks : 0,
    costPerLanding: landingPageViews > 0 ? spend / landingPageViews : 0,
    costPerView: contentViews > 0 ? spend / contentViews : 0,
    costPerAtc: addToCart > 0 ? spend / addToCart : 0,
    costPerCheckout: initiateCheckout > 0 ? spend / initiateCheckout : 0,
    costPerPurchase: purchases > 0 ? spend / purchases : 0,

    // ROI metrics
    roas: spend > 0 ? revenue / spend : 0,
    aov: purchases > 0 ? revenue / purchases : 0,
  };
}

// ============================================
// CREATIVE PERFORMANCE ANALYSIS
// ============================================

/**
 * Calculate creative performance metrics
 */
export function calculateCreativePerformance(row: InsightRow): {
  // Basic metrics
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  spend: number;
  cpc: number;
  cpm: number;

  // Video metrics (if applicable)
  hasVideo: boolean;
  videoViews: number;
  hookRate: number;
  thumbstopRate: number;
  holdRate: number;
  completionRate: number;
  avgWatchTime: number;
  costPerThruPlay: number;

  // Engagement
  engagements: number;
  engagementRate: number;
  costPerEngagement: number;

  // Conversions
  purchases: number;
  purchaseValue: number;
  roas: number;
  costPerPurchase: number;

  // Creative info
  adFormat: string | undefined;
} {
  const impressions = safeParseInt(row.impressions);
  const reach = safeParseInt(row.reach);
  const clicks = safeParseInt(row.clicks);
  const spend = safeParseFloat(row.spend);
  const engagements = safeParseInt(row.inline_post_engagement);

  // Video metrics
  const videoViews = getActionValue(row.actions, "video_view");
  const videoPlays = getVideoMetricValue(row.video_play_actions);
  const video_p25 = getVideoMetricValue(row.video_p25_watched_actions);
  const video_p50 = getVideoMetricValue(row.video_p50_watched_actions);
  const video_p100 = getVideoMetricValue(row.video_p100_watched_actions);
  const avgWatchTime = getVideoMetricValue(row.video_avg_time_watched_actions);
  const thruPlay = getVideoMetricValue(row.video_thruplay_watched_actions);

  const hasVideo = video_p25 > 0 || videoPlays > 0;

  // Conversions
  const purchases = getActionValue(
    row.actions,
    "offsite_conversion.fb_pixel_purchase"
  );
  const purchaseValue = getActionMonetaryValue(
    row.action_values,
    "offsite_conversion.fb_pixel_purchase"
  );

  // Cost per thruplay from API or calculate
  let costPerThruPlay = 0;
  if (row.cost_per_thruplay && row.cost_per_thruplay.length > 0) {
    costPerThruPlay = parseFloat(row.cost_per_thruplay[0].value) || 0;
  } else if (thruPlay > 0) {
    costPerThruPlay = spend / thruPlay;
  }

  return {
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : 0,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    spend,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,

    hasVideo,
    videoViews,
    hookRate: impressions > 0 ? (videoViews / impressions) * 100 : 0,
    thumbstopRate: impressions > 0 ? (videoPlays / impressions) * 100 : 0,
    holdRate: video_p25 > 0 ? (video_p50 / video_p25) * 100 : 0,
    completionRate: video_p25 > 0 ? (video_p100 / video_p25) * 100 : 0,
    avgWatchTime,
    costPerThruPlay,

    engagements,
    engagementRate: impressions > 0 ? (engagements / impressions) * 100 : 0,
    costPerEngagement: engagements > 0 ? spend / engagements : 0,

    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    costPerPurchase: purchases > 0 ? spend / purchases : 0,

    adFormat: row.ad_format_asset,
  };
}

// ============================================
// ACTION STATS NORMALIZATION FOR DISPLAY
// ============================================

/**
 * Fields that return AdsActionStats[] and need to be normalized to numeric values
 */
const ACTION_STATS_FIELDS = [
  "purchase_roas",
  "website_purchase_roas",
  "mobile_app_purchase_roas",
  "cost_per_thruplay",
  "outbound_clicks",
  "unique_outbound_clicks",
  "outbound_clicks_ctr",
  "unique_outbound_clicks_ctr",
  "cost_per_outbound_click",
  "cost_per_unique_outbound_click",
  "cost_per_action_type",
  "cost_per_conversion",
  "website_ctr",
];

/**
 * Video metrics that return AdsActionStats[] and need to be normalized
 * These contain action_type="video_view" with the numeric value
 */
const VIDEO_METRICS_FIELDS = [
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
  "video_thruplay_watched_actions",
  "video_play_actions",
  "video_30_sec_watched_actions",
  "video_10_sec_watched_actions",
  "video_15_sec_watched_actions",
  "video_time_watched_actions", // Total Watch Time - was missing!
];

/**
 * Engagement metrics that may need normalization
 */
const ENGAGEMENT_ACTION_TYPES: Record<string, string> = {
  post_engagement: "post_engagement",
  page_engagement: "page_engagement",
  post_reactions: "post_reaction",
  comments: "comment",
  shares: "post",
  saves: "onsite_conversion.post_save",
  page_likes: "like",
  photo_views: "photo_view",
  video_views: "video_view",
};

/**
 * Map of metric keys to the action_type to extract from the actions array (COUNTS only)
 * NOTE: Monetary values (purchase_value, omni_purchase_value) come from action_values array, not here!
 * IMPORTANT: This mapping must include ALL metrics with apiField: "actions" from metricCatalog.ts
 */
/**
 * ACTIONS_COUNT_METRICS maps metric keys to an array of possible action_types.
 * Meta API returns different action_type prefixes depending on the campaign setup:
 * - "omni_*" for aggregated conversions (default for most campaigns)
 * - "offsite_conversion.fb_pixel_*" for web-specific pixel events
 *
 * We try each action type in order and use the first match found.
 */
const ACTIONS_COUNT_METRICS: Record<string, string[]> = {
  // E-commerce funnel - try omni_ first (most common), then offsite_conversion
  purchases: ["omni_purchase", "offsite_conversion.fb_pixel_purchase"],
  omni_purchases: ["omni_purchase"],
  add_to_cart: ["omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiate_checkout: ["omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  view_content: ["omni_view_content", "offsite_conversion.fb_pixel_view_content"],
  add_payment_info: ["omni_add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"],
  search: ["omni_search", "offsite_conversion.fb_pixel_search"],
  add_to_wishlist: ["omni_add_to_wishlist", "offsite_conversion.fb_pixel_add_to_wishlist"],

  // Leads & conversions
  leads: ["omni_lead", "offsite_conversion.fb_pixel_lead"],
  onsite_leads: ["onsite_conversion.lead_grouped"],
  leadgen_grouped: ["leadgen_grouped"],
  complete_registration: ["omni_complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
  contact: ["offsite_conversion.fb_pixel_contact"],
  schedule: ["offsite_conversion.fb_pixel_schedule"],
  start_trial: ["offsite_conversion.fb_pixel_start_trial"],
  subscribe: ["offsite_conversion.fb_pixel_subscribe"],
  find_location: ["offsite_conversion.fb_pixel_find_location"],

  // Messaging
  messaging_conversations_started: ["onsite_conversion.messaging_conversation_started_7d"],
  messaging_first_reply: ["onsite_conversion.messaging_first_reply"],

  // Website-specific (pixel only, excludes app and shop)
  website_purchases: ["offsite_conversion.fb_pixel_purchase"],

  // App metrics
  app_installs: ["omni_app_install", "mobile_app_install"],
  app_add_to_cart: ["app_custom_event.fb_mobile_add_to_cart"],
  app_initiate_checkout: ["app_custom_event.fb_mobile_initiated_checkout"],
  app_complete_registration: ["app_custom_event.fb_mobile_complete_registration"],
  achievement_unlocked: ["app_custom_event.fb_mobile_achievement_unlocked"],
  credit_spent: ["app_custom_event.fb_mobile_spent_credits"],
  app_start_trial: ["app_custom_event.fb_mobile_start_trial"],
  app_subscribe: ["app_custom_event.fb_mobile_subscribe"],
  app_purchases: ["app_custom_event.fb_mobile_purchase"],

  // Shop / On-platform
  shop_purchases: ["onsite_conversion.purchase"],

  // Engagement & clicks
  landing_page_views: ["landing_page_view"],
  link_clicks: ["link_click"],

  // Video views (from actions array)
  video_views_3s: ["video_view"],

  // Social engagement metrics
  post_reactions: ["post_reaction"], // Reactions on posts (like, love, haha, wow, sad, angry)
  comments: ["comment"],
  shares: ["post"], // Shares = posting to timeline
  page_likes: ["like"], // Page likes/follows
};

/**
 * Metrics that should NOT have attribution windows applied.
 * These are engagement metrics, not conversion events.
 * Attribution should only be applied to purchase/conversion funnel metrics.
 */
const NON_ATTRIBUTION_METRICS = new Set([
  "video_views_3s",      // Video views are engagement, not conversion
  "landing_page_views",  // Landing page views are engagement, not conversion
  "link_clicks",         // Link clicks are engagement, not conversion
  "post_reactions",      // Social engagement
  "comments",            // Social engagement
  "shares",              // Social engagement
  "page_likes",          // Social engagement
]);

/**
 * ACTION_VALUES_METRICS maps metric keys to an array of possible action_types.
 * Similar to ACTIONS_COUNT_METRICS, Meta API returns different prefixes.
 * IMPORTANT: This mapping must include ALL metrics with apiField: "action_values" from metricCatalog.ts
 */
const ACTION_VALUES_METRICS: Record<string, string[]> = {
  // E-commerce funnel values - try omni_ first, then offsite_conversion
  purchase_value: ["omni_purchase", "offsite_conversion.fb_pixel_purchase"],
  omni_purchase_value: ["omni_purchase"],
  add_to_cart_value: ["omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiate_checkout_value: ["omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  view_content_value: ["omni_view_content", "offsite_conversion.fb_pixel_view_content"],

  // Lead & conversion values
  subscribe_value: ["offsite_conversion.fb_pixel_subscribe"],
  leads_value: ["omni_lead", "offsite_conversion.fb_pixel_lead"],
  start_trial_value: ["offsite_conversion.fb_pixel_start_trial"],

  // Website-specific values (pixel only, excludes app and shop)
  website_purchase_value: ["offsite_conversion.fb_pixel_purchase"],

  // App-specific values
  app_purchase_value: ["app_custom_event.fb_mobile_purchase"],

  // Shop / On-platform values
  shop_purchase_value: ["onsite_conversion.purchase"],
};

/**
 * Map of metric keys to the action_type to extract from the cost_per_action_type array
 * IMPORTANT: This mapping must include ALL metrics with apiField: "cost_per_action_type" from metricCatalog.ts
 *
 * Bug #9 Fix: Without this mapping, all cost_per_* metrics would show the same value (value[0] of the array)
 */
/**
 * COST_PER_ACTION_METRICS maps metric keys to an array of possible action_types.
 * Meta API returns different action_type prefixes depending on the campaign setup:
 * - "omni_*" for aggregated conversions (default for most campaigns)
 * - "offsite_conversion.fb_pixel_*" for web-specific pixel events
 * - "app_custom_event.*" for app-specific events
 *
 * We try each action type in order and use the first match found.
 */
const COST_PER_ACTION_METRICS: Record<string, string[]> = {
  // Conversions - try omni_ first (most common), then offsite_conversion
  cost_per_purchase: ["omni_purchase", "offsite_conversion.fb_pixel_purchase"],
  cost_per_lead: ["omni_lead", "offsite_conversion.fb_pixel_lead"],
  cost_per_add_to_cart: ["omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  cost_per_initiate_checkout: ["omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  cost_per_complete_registration: ["omni_complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
  cost_per_contact: ["omni_custom", "offsite_conversion.fb_pixel_contact"],
  cost_per_schedule: ["omni_custom", "offsite_conversion.fb_pixel_schedule"],
  cost_per_start_trial: ["omni_custom", "offsite_conversion.fb_pixel_start_trial"],
  cost_per_subscribe: ["omni_custom", "offsite_conversion.fb_pixel_subscribe"],
  cost_per_view_content: ["omni_view_content", "offsite_conversion.fb_pixel_view_content"],
  cost_per_search: ["omni_search", "offsite_conversion.fb_pixel_search"],
  cost_per_add_to_wishlist: ["omni_add_to_wishlist", "offsite_conversion.fb_pixel_add_to_wishlist"],
  cost_per_add_payment_info: ["omni_add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"],
  cost_per_find_location: ["offsite_conversion.fb_pixel_find_location"],

  // App events
  cost_per_app_install: ["omni_app_install", "mobile_app_install"],
  cost_per_app_add_to_cart: ["app_custom_event.fb_mobile_add_to_cart"],
  cost_per_app_initiate_checkout: ["app_custom_event.fb_mobile_initiated_checkout"],
  cost_per_app_purchase: ["app_custom_event.fb_mobile_purchase"],

  // Engagement
  cost_per_page_like: ["like"],
  cost_per_page_engagement: ["page_engagement"],
  cost_per_post_engagement: ["post_engagement"],
  cost_per_link_click: ["link_click"],
  cost_per_landing_page_view: ["landing_page_view"],
  cost_per_3s_video_view: ["video_view"],

  // Messaging
  cost_per_messaging_conversation: ["onsite_conversion.messaging_conversation_started_7d"],
  cost_per_messaging_first_reply: ["onsite_conversion.messaging_first_reply"],

  // On-platform
  cost_per_onsite_lead: ["onsite_conversion.lead_grouped"],
  cost_per_shop_purchase: ["onsite_conversion.purchase"],
};

/**
 * Extract a numeric value from an AdsActionStats array
 * - If actionType is provided, find the matching action_type
 * - Otherwise, return the first value or sum all values
 */
function extractValueFromActionStats(
  actionStats: AdsActionStats[] | undefined,
  actionType?: string
): number | undefined {
  if (!actionStats || !Array.isArray(actionStats) || actionStats.length === 0) {
    return undefined;
  }

  if (actionType) {
    // Find specific action type
    const action = actionStats.find((a) => a.action_type === actionType);
    if (action) {
      return parseFloat(action.value);
    }
    return undefined;
  }

  // For fields like purchase_roas that have a single value or "omni_purchase" type
  // Try common action types first
  const commonTypes = ["omni_purchase", "offsite_conversion.fb_pixel_purchase"];
  for (const type of commonTypes) {
    const action = actionStats.find((a) => a.action_type === type);
    if (action) {
      return parseFloat(action.value);
    }
  }

  // Fall back to first value
  if (actionStats.length > 0) {
    return parseFloat(actionStats[0].value);
  }

  return undefined;
}

/**
 * Normalize a single insight row by extracting numeric values from AdsActionStats[] arrays
 * This makes the data display-ready for the frontend
 */
export function normalizeRowForDisplay(row: InsightRow): InsightRow & Record<string, unknown> {
  const normalized: InsightRow & Record<string, unknown> = { ...row };

  // Normalize action stats fields (purchase_roas, cost_per_thruplay, etc.)
  // Debug: Log which ACTION_STATS_FIELDS are present in the row
  if (!("_actionStatsLogged" in normalizeRowForDisplay)) {
    (normalizeRowForDisplay as unknown as Record<string, boolean>)._actionStatsLogged = true;
    const presentFields = ACTION_STATS_FIELDS.filter(f => normalized[f as keyof InsightRow] !== undefined);
    logger.debug("meta", "Normalize action stats fields present in row", { presentFields });
    for (const field of presentFields) {
      const val = normalized[field as keyof InsightRow];
      logger.debug("meta", "Normalize action stats field sample", {
        field,
        type: Array.isArray(val) ? `Array(${(val as unknown[]).length})` : typeof val,
        sample: Array.isArray(val) && (val as AdsActionStats[]).length > 0
          ? (val as AdsActionStats[]).slice(0, 3).map(a => `${a.action_type}: ${a.value}`)
          : val,
      });
    }
  }

  for (const field of ACTION_STATS_FIELDS) {
    const value = normalized[field as keyof InsightRow];
    if (Array.isArray(value)) {
      const numValue = extractValueFromActionStats(value as AdsActionStats[]);
      if (numValue !== undefined) {
        normalized[field] = numValue;
      }
    }
  }

  // Extract COUNT metrics from actions array (purchases, add_to_cart, etc.)
  if (normalized.actions && Array.isArray(normalized.actions)) {
    const actions = normalized.actions as AdsActionStats[];

    for (const [metricKey, actionType] of Object.entries(ACTIONS_COUNT_METRICS)) {
      if (normalized[metricKey] === undefined) {
        const value = getActionValue(actions, actionType);
        // Include zero values - they are valid data, not missing data
        if (value >= 0) {
          normalized[metricKey] = value;
        }
      }
    }

    // Debug: Log video_views_3s extraction specifically
    if (!("_video3sLogged" in normalizeRowForDisplay)) {
      (normalizeRowForDisplay as unknown as Record<string, boolean>)._video3sLogged = true;
      const videoViewAction = actions.find(a => a.action_type === "video_view");
      logger.debug("meta", "Normalize video_views_3s extraction from actions", {
        video_view_action_found: !!videoViewAction,
        video_view_raw_value: videoViewAction?.value,
        video_views_3s_stored: normalized.video_views_3s,
        actions_with_video: actions.filter(a => a.action_type?.includes("video")).map(a => ({ action_type: a.action_type, value: a.value })),
      });
    }
  }

  // Extract MONETARY values from action_values array (purchase_value, etc.)
  if (normalized.action_values && Array.isArray(normalized.action_values)) {
    const actionValues = normalized.action_values as AdsActionStats[];

    // Debug: Log first row's action_values for purchase
    if (!("_actionValuesLogged" in normalizeRowForDisplay)) {
      (normalizeRowForDisplay as unknown as Record<string, boolean>)._actionValuesLogged = true;
      const purchaseValue = actionValues.find(a =>
        a.action_type === "offsite_conversion.fb_pixel_purchase" || a.action_type === "omni_purchase"
      );
      logger.debug("meta", "Normalize action_values sample", {
        totalActionValues: actionValues.length,
        purchaseValueEntry: purchaseValue || "(not found)",
        allActionTypes: actionValues.slice(0, 5).map(a => a.action_type),
      });
    }

    for (const [metricKey, actionType] of Object.entries(ACTION_VALUES_METRICS)) {
      if (normalized[metricKey] === undefined) {
        const value = getActionMonetaryValue(actionValues, actionType);
        // Include zero values - they are valid data, not missing data
        if (value >= 0) {
          normalized[metricKey] = value;
        }
      }
    }
  }

  // Extract COST PER ACTION metrics from cost_per_action_type array
  // Bug #9 Fix: Without this, all cost_per_* metrics would show the same value (value[0] of the array)
  if (normalized.cost_per_action_type && Array.isArray(normalized.cost_per_action_type)) {
    const costPerActions = normalized.cost_per_action_type as AdsActionStats[];

    // Debug: Log first row's cost_per_action_type for debugging
    if (!("_costPerActionLogged" in normalizeRowForDisplay)) {
      (normalizeRowForDisplay as unknown as Record<string, boolean>)._costPerActionLogged = true;
      logger.debug("meta", "Normalize cost_per_action_type action types", {
        totalEntries: costPerActions.length,
        allActionTypes: costPerActions.map(a => a.action_type),
      });
    }

    for (const [metricKey, actionTypes] of Object.entries(COST_PER_ACTION_METRICS)) {
      if (normalized[metricKey] === undefined) {
        // Try each action type in order until we find a match
        for (const actionType of actionTypes) {
          const action = costPerActions.find((a) => a.action_type === actionType);
          if (action) {
            const value = parseFloat(action.value);
            if (!isNaN(value) && value >= 0) {
              normalized[metricKey] = value;
              break; // Found a match, stop searching
            }
          }
        }
      }
    }
  }

  // Normalize VIDEO metrics (video_p25_watched_actions, video_p50_watched_actions, etc.)
  // Debug: log first row's video metrics processing
  if (!("_videoMetricsLogged" in normalizeRowForDisplay)) {
    (normalizeRowForDisplay as unknown as Record<string, boolean>)._videoMetricsLogged = true;
    const videoFieldsPresent = VIDEO_METRICS_FIELDS.filter(f => normalized[f as keyof InsightRow] !== undefined);
    logger.debug("meta", "Normalize video metrics in row", {
      fieldsPresent: videoFieldsPresent,
      video_time_watched_raw: normalized.video_time_watched_actions,
      video_30_sec_raw: normalized.video_30_sec_watched_actions,
      video_p25_sample: normalized.video_p25_watched_actions,
    });
    // Detailed debug for Total Watch Time
    if (normalized.video_time_watched_actions) {
      const vtw = normalized.video_time_watched_actions as AdsActionStats[] | number;
      if (Array.isArray(vtw)) {
        logger.debug("meta", "Normalize video_time_watched_actions array details", {
          length: vtw.length,
          items: vtw.slice(0, 5).map(a => ({ action_type: a.action_type, value: a.value })),
          extracted: getVideoMetricValue(vtw),
        });
      } else {
        logger.debug("meta", "Normalize video_time_watched_actions is not array", { type: typeof vtw, value: vtw });
      }
    } else {
      logger.debug("meta", "Normalize video_time_watched_actions is undefined in row");
    }
  }

  for (const field of VIDEO_METRICS_FIELDS) {
    const value = normalized[field as keyof InsightRow];
    if (Array.isArray(value)) {
      const numValue = getVideoMetricValue(value as AdsActionStats[]);
      // Include zero values - they are valid data
      if (numValue >= 0) {
        normalized[field] = numValue;
      }

      // Debug: Log video_30_sec extraction specifically
      if (field === "video_30_sec_watched_actions" && !("_video30sLogged" in normalizeRowForDisplay)) {
        (normalizeRowForDisplay as unknown as Record<string, boolean>)._video30sLogged = true;
        const actions30s = value as AdsActionStats[];
        logger.debug("meta", "Normalize video_30_sec_watched_actions extraction", {
          array_length: actions30s.length,
          all_items: actions30s.map(a => ({ action_type: a.action_type, value: a.value })),
          extracted_value: numValue,
          stored_as: "video_30_sec_watched_actions",
        });
      }
    } else if (typeof value === "number" || typeof value === "string") {
      // Value is already a number or string - parse it
      const numValue = parseFloat(String(value));
      if (!isNaN(numValue)) {
        normalized[field] = numValue;
      }
    }
  }

  // FALLBACK: Calculate Total Watch Time if not returned by API
  // Meta API sometimes doesn't return video_time_watched_actions, but we can estimate it
  // from: Total Watch Time ≈ Average Watch Time × Video Views
  const currentTotalWatchTime = normalized.video_time_watched_actions;
  const totalWatchTimeIsMissing =
    currentTotalWatchTime === undefined ||
    (typeof currentTotalWatchTime === "number" && currentTotalWatchTime === 0) ||
    (Array.isArray(currentTotalWatchTime) && currentTotalWatchTime.length === 0);

  if (
    totalWatchTimeIsMissing &&
    typeof normalized.video_avg_time_watched_actions === "number" &&
    normalized.video_avg_time_watched_actions > 0 &&
    typeof normalized.video_views_3s === "number" &&
    normalized.video_views_3s > 0
  ) {
    const estimatedTotalWatchTime = normalized.video_avg_time_watched_actions * normalized.video_views_3s;
    (normalized as Record<string, unknown>).video_time_watched_actions = estimatedTotalWatchTime;

    // Log once for debugging
    if (!("_totalWatchTimeFallback" in normalizeRowForDisplay)) {
      (normalizeRowForDisplay as unknown as Record<string, boolean>)._totalWatchTimeFallback = true;
      logger.debug("meta", "Normalize total watch time fallback calculated", {
        video_avg_time_watched: normalized.video_avg_time_watched_actions,
        video_views_3s: normalized.video_views_3s,
        estimated_total_watch_time: estimatedTotalWatchTime,
        note: "video_time_watched_actions not returned by API, using estimate",
      });
    }
  }

  // Extract ENGAGEMENT metrics from actions array
  if (normalized.actions && Array.isArray(normalized.actions)) {
    const actions = normalized.actions as AdsActionStats[];

    for (const [metricKey, actionType] of Object.entries(ENGAGEMENT_ACTION_TYPES)) {
      if (normalized[metricKey] === undefined) {
        const value = getActionValue(actions, actionType);
        // Include zero values - they are valid data
        if (value >= 0) {
          normalized[metricKey] = value;
        }
      }
    }
  }

  // Debug: Final comparison of 3s vs 30s video views
  if (!("_videoComparisonLogged" in normalizeRowForDisplay)) {
    (normalizeRowForDisplay as unknown as Record<string, boolean>)._videoComparisonLogged = true;
    const val3s = typeof normalized.video_views_3s === "number" ? normalized.video_views_3s : 0;
    const val30s = typeof normalized.video_30_sec_watched_actions === "number" ? normalized.video_30_sec_watched_actions : 0;
    logger.debug("meta", "Normalize video views comparison", {
      "3_second_views (video_views_3s)": val3s,
      "30_second_views (video_30_sec_watched_actions)": val30s,
      dataKey_for_3s: "video_views_3s",
      dataKey_for_30s: "video_30_sec_watched_actions",
      logically_valid: val3s >= val30s,
      potential_bug: val30s > val3s ? "30s > 3s - VALUES MAY BE SWAPPED!" : "OK",
    });
  }

  return normalized;
}

/**
 * Normalize all rows in a data array for display
 * Extracts numeric values from AdsActionStats[] arrays
 * @param data - Array of InsightRow from API
 * @param attribution - Optional attribution settings (default: 7d click + 1d view)
 * @param displayMode - Optional display mode for attribution data
 */
export function normalizeDataForDisplay(
  data: InsightRow[],
  attribution?: AttributionSettings,
  displayMode?: AttributionDisplayMode
): (InsightRow & Record<string, unknown>)[] {
  const settings = attribution || DEFAULT_ATTRIBUTION;
  const mode = displayMode || "combined";

  return data.map((row) => normalizeRowWithAttribution(row, settings, mode));
}

/**
 * Normalize a row with specific attribution settings
 */
function normalizeRowWithAttribution(
  row: InsightRow,
  attribution: AttributionSettings,
  displayMode: AttributionDisplayMode
): InsightRow & Record<string, unknown> {
  // First apply the basic normalization
  const normalized = normalizeRowForDisplay(row);

  // If using default combined mode, just use the default values
  if (displayMode === "combined") {
    // The API default value is already 7d_click + 1d_view, which matches our default
    // Only recalculate if using non-default attribution settings
    if (
      attribution.clickWindow !== "7d_click" ||
      attribution.viewWindow !== "1d_view" ||
      !attribution.includeViewThrough
    ) {
      // Re-extract conversion metrics with custom attribution
      applyCustomAttribution(normalized, attribution);
    }
    return normalized;
  }

  // Handle split view mode - add _click, _view, _total columns
  if (displayMode === "split") {
    applySplitAttribution(normalized, attribution);
    return normalized;
  }

  // Handle click_only or view_only mode
  if (displayMode === "click_only") {
    applyClickOnlyAttribution(normalized, attribution);
    return normalized;
  }

  if (displayMode === "view_only") {
    applyViewOnlyAttribution(normalized, attribution);
    return normalized;
  }

  return normalized;
}

/**
 * Apply custom attribution settings to conversion metrics
 */
function applyCustomAttribution(
  row: InsightRow & Record<string, unknown>,
  attribution: AttributionSettings
): void {
  const actions = row.actions as AdsActionStats[] | undefined;
  const actionValues = row.action_values as AdsActionStats[] | undefined;

  // Re-calculate count metrics with attribution
  // Skip non-conversion metrics (video views, engagement metrics) - they should always use total value
  for (const [metricKey, actionType] of Object.entries(ACTIONS_COUNT_METRICS)) {
    if (NON_ATTRIBUTION_METRICS.has(metricKey)) {
      // Skip - these metrics should not have attribution applied
      continue;
    }
    const value = getActionValueWithAttribution(actions, actionType, attribution);
    // Include zero values - they are valid data, not missing data
    if (value >= 0) {
      row[metricKey] = value;
    }
  }

  // Re-calculate monetary metrics with attribution
  for (const [metricKey, actionType] of Object.entries(ACTION_VALUES_METRICS)) {
    const value = getActionMonetaryValueWithAttribution(actionValues, actionType, attribution);
    // Include zero values - they are valid data, not missing data
    if (value >= 0) {
      row[metricKey] = value;
    }
  }

  // Re-calculate cost_per_action_type metrics with attribution
  const costPerActions = row.cost_per_action_type;
  if (costPerActions && Array.isArray(costPerActions)) {
    const costActions = costPerActions as AdsActionStats[];
    for (const [metricKey, actionTypes] of Object.entries(COST_PER_ACTION_METRICS)) {
      for (const actionType of actionTypes) {
        const action = costActions.find((a) => a.action_type === actionType);
        if (action) {
          const clickValue = parseFloat(action[attribution.clickWindow] || "0");
          const viewValue = attribution.includeViewThrough
            ? parseFloat(action[attribution.viewWindow] || "0")
            : 0;
          // For cost-per metrics, use the click window value (not sum of click+view)
          // CPA per window is already a ratio; combined CPA = spend / combined_conversions
          // Fallback: if per-window CPA isn't available, recalculate from base metrics
          if (clickValue > 0 || viewValue > 0) {
            // Recalculate from base: CPA = spend / conversions(combined_windows)
            const spend = parseFloat(String(row.spend ?? 0));
            const baseMetricKey = metricKey.replace("cost_per_", "");
            const conversions = typeof row[baseMetricKey] === "number" ? (row[baseMetricKey] as number) : 0;
            if (spend > 0 && conversions > 0) {
              row[metricKey] = spend / conversions;
            }
          }
          break;
        }
      }
    }
  }

  // Re-calculate ROAS metrics from corrected base values
  const spend = parseFloat(String(row.spend ?? 0));
  if (spend > 0) {
    const purchaseValue = typeof row.purchase_value === "number" ? row.purchase_value : 0;
    if (purchaseValue > 0) {
      (row as Record<string, unknown>).purchase_roas = purchaseValue / spend;
      (row as Record<string, unknown>).website_purchase_roas = purchaseValue / spend;
    }
  }
}

/**
 * Apply split attribution - adds _click, _view, _total columns for each conversion metric
 */
function applySplitAttribution(
  row: InsightRow & Record<string, unknown>,
  attribution: AttributionSettings
): void {
  const actions = row.actions as AdsActionStats[] | undefined;
  const actionValues = row.action_values as AdsActionStats[] | undefined;

  // Split count metrics
  // Skip non-conversion metrics (video views, engagement metrics) - they should not be split by attribution
  for (const [metricKey, actionType] of Object.entries(ACTIONS_COUNT_METRICS)) {
    if (NON_ATTRIBUTION_METRICS.has(metricKey)) {
      // Skip - these metrics should not have attribution applied
      continue;
    }
    const split = getActionValuesSplit(actions, actionType, attribution);
    // Include zero values - they are valid data, not missing data
    if (split.total >= 0) {
      row[`${metricKey}_click`] = split.click;
      row[`${metricKey}_view`] = split.view;
      row[`${metricKey}_total`] = split.total;
      row[metricKey] = split.total; // Keep the main metric as total
    }
  }

  // Split monetary metrics
  for (const [metricKey, actionType] of Object.entries(ACTION_VALUES_METRICS)) {
    const split = getActionMonetaryValuesSplit(actionValues, actionType, attribution);
    // Include zero values - they are valid data, not missing data
    if (split.total >= 0) {
      row[`${metricKey}_click`] = split.click;
      row[`${metricKey}_view`] = split.view;
      row[`${metricKey}_total`] = split.total;
      row[metricKey] = split.total; // Keep the main metric as total
    }
  }
}

/**
 * Apply click-only attribution
 */
function applyClickOnlyAttribution(
  row: InsightRow & Record<string, unknown>,
  attribution: AttributionSettings
): void {
  const clickOnlyAttribution: AttributionSettings = {
    ...attribution,
    includeViewThrough: false,
  };
  applyCustomAttribution(row, clickOnlyAttribution);
}

/**
 * Apply view-only attribution
 */
function applyViewOnlyAttribution(
  row: InsightRow & Record<string, unknown>,
  attribution: AttributionSettings
): void {
  const actions = row.actions as AdsActionStats[] | undefined;
  const actionValues = row.action_values as AdsActionStats[] | undefined;

  // Extract only view-through values
  // Skip non-conversion metrics (video views, engagement metrics) - they should always use total value
  for (const [metricKey, actionTypes] of Object.entries(ACTIONS_COUNT_METRICS)) {
    if (NON_ATTRIBUTION_METRICS.has(metricKey)) {
      // Skip - these metrics should not have attribution applied
      continue;
    }
    if (actions) {
      // Try each action type in order
      for (const actionType of actionTypes) {
        const action = actions.find((a) => a.action_type === actionType);
        if (action) {
          const value = parseFloat(action[attribution.viewWindow] || "0");
          // Include zero values - they are valid data, not missing data
          if (value >= 0) {
            row[metricKey] = value;
          }
          break; // Found a match, stop searching
        }
      }
    }
  }

  for (const [metricKey, actionTypes] of Object.entries(ACTION_VALUES_METRICS)) {
    if (actionValues) {
      // Try each action type in order
      for (const actionType of actionTypes) {
        const action = actionValues.find((a) => a.action_type === actionType);
        if (action) {
          const value = parseFloat(action[attribution.viewWindow] || "0");
          // Include zero values - they are valid data, not missing data
          if (value >= 0) {
            row[metricKey] = value;
          }
          break; // Found a match, stop searching
        }
      }
    }
  }
}

// ============================================
// DATA FORMATTING UTILITIES
// ============================================

/**
 * Format a number as currency
 */
export function formatCurrency(
  value: number,
  currency: string = "EUR",
  locale: string = "fr-FR"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a number as percentage
 */
export function formatPercentage(
  value: number,
  decimals: number = 2
): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a large number with abbreviation
 */
export function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

/**
 * Format duration in seconds to human readable
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}
