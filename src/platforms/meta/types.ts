/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// ============================================
// META MARKETING API TYPES FOR BENLY REPORTS
// ============================================

// --- Configuration ---

export interface MetaApiConfig {
  accessToken: string;
  adAccountId: string; // Format: "act_123456789"
  apiVersion: string;  // "v26.0"
}

export interface TimeRange {
  since: string; // "YYYY-MM-DD"
  until: string; // "YYYY-MM-DD"
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "maximum"
  | "data_maximum"
  | "last_3d"
  | "last_7d"
  | "last_14d"
  | "last_28d"
  | "last_30d"
  | "last_90d"
  | "last_week_mon_sun"
  | "last_week_sun_sat"
  | "last_quarter"
  | "last_year"
  | "this_week_mon_today"
  | "this_week_sun_today"
  | "this_year";

export type InsightsLevel = "ad" | "adset" | "campaign" | "account";

export type TimeIncrement = 1 | 7 | 14 | 28 | 30 | "monthly" | "all_days";

// --- Attribution Windows ---

/**
 * Attribution window for click-through conversions
 * - 1d_click: Conversions within 1 day of click
 * - 7d_click: Conversions within 7 days of click (default)
 * - 28d_click: Conversions within 28 days of click
 */
export type ClickAttributionWindow = "1d_click" | "7d_click" | "28d_click";

/**
 * Attribution window for view-through conversions
 * - 1d_view: Conversions within 1 day of view (no click)
 * - 1d_ev: Conversions within 1 day of engaged video view (10+ seconds)
 * Note: 7d_view and 28d_view are DEPRECATED as of Jan 2026
 */
export type ViewAttributionWindow = "1d_view" | "1d_ev";

/**
 * Combined attribution window settings
 */
export interface AttributionSettings {
  /** Click attribution window (default: 7d_click) */
  clickWindow: ClickAttributionWindow;
  /** View attribution window (default: 1d_view) */
  viewWindow: ViewAttributionWindow;
  /** Whether to include view-through conversions (default: true) */
  includeViewThrough: boolean;
}

/**
 * Display mode for attribution data
 * - combined: Show total (click + view) - default
 * - click_only: Show only click-through conversions
 * - view_only: Show only view-through conversions
 * - split: Show click, view, and total in separate columns
 */
export type AttributionDisplayMode = "combined" | "click_only" | "view_only" | "split";

/**
 * Preset attribution configurations matching Meta Ads Manager
 */
export const ATTRIBUTION_PRESETS = {
  /** Default: 7-day click + 1-day view */
  default: {
    clickWindow: "7d_click" as ClickAttributionWindow,
    viewWindow: "1d_view" as ViewAttributionWindow,
    includeViewThrough: true,
  },
  /** Click only: 7-day click, no view */
  click_7d: {
    clickWindow: "7d_click" as ClickAttributionWindow,
    viewWindow: "1d_view" as ViewAttributionWindow,
    includeViewThrough: false,
  },
  /** Click only: 1-day click, no view */
  click_1d: {
    clickWindow: "1d_click" as ClickAttributionWindow,
    viewWindow: "1d_view" as ViewAttributionWindow,
    includeViewThrough: false,
  },
  /** Click only: 28-day click, no view */
  click_28d: {
    clickWindow: "28d_click" as ClickAttributionWindow,
    viewWindow: "1d_view" as ViewAttributionWindow,
    includeViewThrough: false,
  },
  /** Engaged view: 7-day click + 1-day engaged view (video) */
  engaged_view: {
    clickWindow: "7d_click" as ClickAttributionWindow,
    viewWindow: "1d_ev" as ViewAttributionWindow,
    includeViewThrough: true,
  },
} as const;

export type AttributionPreset = keyof typeof ATTRIBUTION_PRESETS;

// --- Metric Categories ---

export type MetricCategory =
  | "delivery"
  | "cost"
  | "video"
  | "conversion"
  | "engagement"
  | "calculated";

export type MetricType = "native" | "calculated";

export type MetricFormat =
  | "number"
  | "currency"
  | "percentage"
  | "duration"
  | "ratio";

// --- Breakdown Categories ---

export type BreakdownCategory =
  | "demographic"
  | "audience"
  | "geographic"
  | "platform"
  | "creative"
  | "product"
  | "time"
  | "action"
  | "skan";

// --- Breakdowns ---

export type DemographicBreakdown = "age" | "gender";

export type GeographicBreakdown = "country" | "region" | "dma";

export type PlatformBreakdown =
  | "publisher_platform"
  | "platform_position"
  | "device_platform"
  | "impression_device";

export type CreativeBreakdown =
  | "image_asset"
  | "video_asset"
  | "body_asset"
  | "title_asset"
  | "description_asset"
  | "call_to_action_asset"
  | "link_url_asset"
  | "ad_format_asset"
  | "media_type"
  | "media_format"
  | "flexible_format_asset_type"
  | "gen_ai_asset_type";

export type ProductBreakdown =
  | "product_id"
  | "product_brand_breakdown"
  | "product_category_breakdown"
  | "product_type_breakdown"
  | "product_custom_label_0_breakdown"
  | "product_custom_label_1_breakdown"
  | "product_custom_label_2_breakdown"
  | "product_custom_label_3_breakdown"
  | "product_custom_label_4_breakdown"
  | "product_group_content_id_breakdown";

export type TimeBreakdown =
  | "hourly_stats_aggregated_by_advertiser_time_zone"
  | "hourly_stats_aggregated_by_audience_time_zone"
  | "frequency_value";

export type ActionBreakdown =
  | "action_type"
  | "action_device"
  | "action_destination"
  | "action_target_id"
  | "action_reaction"
  | "action_video_sound"
  | "action_video_type"
  | "action_carousel_card_id"
  | "action_carousel_card_name"
  | "action_canvas_component_name"
  | "conversion_destination"
  | "standard_event_content_type"
  | "signal_source_bucket"
  | "is_business_ai_assisted";

export type SkanBreakdown =
  | "skan_campaign_id"
  | "skan_conversion_id"
  | "skan_version"
  | "coarse_conversion_value"
  | "postback_sequence_index"
  | "fidelity_type"
  | "redownload";

export type Breakdown =
  | DemographicBreakdown
  | GeographicBreakdown
  | PlatformBreakdown
  | CreativeBreakdown
  | ProductBreakdown
  | TimeBreakdown;

// --- Catalog Definitions ---

export interface MetricDefinition {
  key: string;
  name: string;
  description: string;
  category: MetricCategory;
  type: MetricType;
  format: MetricFormat;
  apiField?: string; // Native field name if different from key
  compatibleBreakdowns: string[];
  incompatibleBreakdowns?: string[];
  requiredFields?: string[]; // For calculated metrics
  levelRestrictions?: InsightsLevel[]; // Only available at these levels
  historicalLimit?: number; // Months of historical data available
  isEstimated?: boolean;
  isDeprecated?: boolean;
  actionType?: string; // For action-based metrics
}

export interface BreakdownDefinition {
  key: string;
  name: string;
  description: string;
  category: BreakdownCategory;
  possibleValues?: string[];
  levelRestrictions?: InsightsLevel[]; // Only available at these levels
  historicalLimit?: number; // Months of historical data available
  blocksOffsiteMetrics?: boolean;
  requiresCombination?: string[]; // Must combine with these breakdowns
  cannotCombineWith?: string[]; // Cannot use with these breakdowns
}

// --- API Response Structures ---

export interface AdsActionStats {
  action_type: string;
  value: string; // Always string, parse to number
  "1d_click"?: string;
  "7d_click"?: string;
  "28d_click"?: string;
  "1d_view"?: string;
  "1d_ev"?: string;
}

export interface AdsHistogramStats {
  action_type: string;
  value: number[];
}

export interface ImageAsset {
  id: string;
  name?: string;
  url?: string;
  url_tags?: string;
  hash?: string;
  image_crops?: Record<string, unknown>;
}

export interface VideoAsset {
  id: string;
  thumbnail_url?: string;
  video_id?: string;
  video_name?: string;
}

export interface TextAsset {
  id: string;
  text: string;
}

export interface InsightRow {
  // Identifiers
  account_id?: string;
  account_name?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;

  // Time period
  date_start: string;
  date_stop: string;

  // Delivery metrics
  impressions?: string;
  reach?: string;
  frequency?: string;
  social_reach?: string;
  social_impressions?: string;
  full_view_impressions?: string;
  full_view_reach?: string;

  // Click metrics
  clicks?: string;
  unique_clicks?: string;
  inline_link_clicks?: string;
  unique_inline_link_clicks?: string;
  social_clicks?: string;
  unique_social_clicks?: string;
  instant_experience_clicks_to_open?: string;
  instant_experience_clicks_to_start?: string;

  // CTR metrics
  ctr?: string;
  unique_ctr?: string;
  inline_link_click_ctr?: string;
  unique_inline_link_click_ctr?: string;

  // Cost metrics
  spend?: string;
  cpc?: string;
  cpm?: string;
  cpp?: string;
  cost_per_inline_link_click?: string;
  cost_per_unique_click?: string;
  cost_per_unique_inline_link_click?: string;
  cost_per_inline_post_engagement?: string;
  cost_per_ad_click?: string;
  social_spend?: string;

  // Engagement metrics
  inline_post_engagement?: string;

  // Video metrics
  video_play_actions?: AdsActionStats[];
  video_10_sec_watched_actions?: AdsActionStats[];
  video_15_sec_watched_actions?: AdsActionStats[];
  video_30_sec_watched_actions?: AdsActionStats[];
  video_p25_watched_actions?: AdsActionStats[];
  video_p50_watched_actions?: AdsActionStats[];
  video_p75_watched_actions?: AdsActionStats[];
  video_p95_watched_actions?: AdsActionStats[];
  video_p100_watched_actions?: AdsActionStats[];
  video_thruplay_watched_actions?: AdsActionStats[];
  video_avg_time_watched_actions?: AdsActionStats[];
  video_time_watched_actions?: AdsActionStats[];
  video_continuous_2_sec_watched_actions?: AdsActionStats[];
  video_play_curve_actions?: AdsHistogramStats[];
  video_play_retention_0_to_15s_actions?: AdsHistogramStats[];
  video_play_retention_20_to_60s_actions?: AdsHistogramStats[];
  video_play_retention_graph_actions?: AdsHistogramStats[];

  // Canvas/Instant Experience metrics
  canvas_avg_view_percent?: string;
  canvas_avg_view_time?: string;
  canvas_component_avg_pct_view?: Record<string, unknown>;

  // Action metrics (arrays)
  actions?: AdsActionStats[];
  action_values?: AdsActionStats[];
  conversions?: AdsActionStats[];
  conversion_values?: AdsActionStats[];
  cost_per_action_type?: AdsActionStats[];
  cost_per_conversion?: AdsActionStats[];
  outbound_clicks?: AdsActionStats[];
  unique_outbound_clicks?: AdsActionStats[];
  outbound_clicks_ctr?: AdsActionStats[];
  unique_outbound_clicks_ctr?: AdsActionStats[];
  cost_per_outbound_click?: AdsActionStats[];
  cost_per_unique_outbound_click?: AdsActionStats[];
  website_ctr?: AdsActionStats[];
  cost_per_thruplay?: AdsActionStats[];
  instant_experience_outbound_clicks?: AdsActionStats[];

  // ROAS metrics
  purchase_roas?: AdsActionStats[];
  website_purchase_roas?: AdsActionStats[];
  mobile_app_purchase_roas?: AdsActionStats[];

  // Quality metrics
  quality_score_organic?: string;
  quality_score_ecpm?: string;
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  relevance_score?: Record<string, unknown>;

  // Awareness metrics
  estimated_ad_recall_rate?: string;
  estimated_ad_recallers?: string;
  estimated_ad_recall_rate_lower_bound?: string;
  estimated_ad_recall_rate_upper_bound?: string;
  cost_per_estimated_ad_recallers?: string;

  // Store visits
  store_visit_actions?: AdsActionStats[];
  cost_per_store_visit_action?: AdsActionStats[];

  // Catalog metrics
  catalog_segment_actions?: AdsActionStats[];
  catalog_segment_value?: AdsActionStats[];

  // Results metrics
  results?: Array<{ indicator: string; values: Array<{ value: string }> }>;
  result_rate?: Array<{ indicator: string; values: Array<{ value: string }> }>;
  cost_per_result?: Array<{ indicator: string; values: Array<{ value: string }> }>;
  results_indicator?: string;

  // Campaign info
  objective?: string;
  optimization_goal?: string;
  bid_strategy?: string;
  budget_remaining?: string;
  buying_type?: string;
  labels?: string[];

  // Breakdowns (present if requested)
  age?: string;
  gender?: string;
  user_segment_key?: string;
  country?: string;
  region?: string;
  dma?: string;
  publisher_platform?: string;
  platform_position?: string;
  device_platform?: string;
  impression_device?: string;

  // Creative breakdowns
  image_asset?: ImageAsset;
  video_asset?: VideoAsset;
  body_asset?: TextAsset;
  title_asset?: TextAsset;
  description_asset?: TextAsset;
  call_to_action_asset?: TextAsset;
  link_url_asset?: { id: string; website_url: string };
  ad_format_asset?: string;
  media_type?: string;
  media_format?: string;

  // Product breakdowns
  product_id?: string;

  // Time breakdowns
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
  hourly_stats_aggregated_by_audience_time_zone?: string;
  frequency_value?: string;

  // Action breakdowns
  action_carousel_card_id?: string;
  action_carousel_card_name?: string;

  // Allow additional fields
  [key: string]: unknown;
}

export interface InsightsApiResponse {
  data: InsightRow[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
    previous?: string;
  };
}

// --- Insights Request Types ---

export interface InsightsQueryRequest {
  adAccountId: string;
  level: InsightsLevel;
  metrics: string[];
  breakdowns?: string[];
  actionBreakdowns?: string[];
  /** Additional dimension fields to include in results (e.g., effective_status, objective) */
  dimensions?: string[];
  timeRange?: TimeRange;
  datePreset?: DatePreset;
  timeIncrement?: TimeIncrement;
  filtering?: InsightFilter[];
  limit?: number;
  /** Attribution window settings for conversion metrics */
  attribution?: AttributionSettings;
  /** How to display attribution data (combined, click_only, view_only, split) */
  attributionDisplayMode?: AttributionDisplayMode;
}

export interface InsightFilter {
  field: string;
  operator: "EQUAL" | "NOT_EQUAL" | "GREATER_THAN" | "LESS_THAN" | "IN" | "NOT_IN" | "CONTAINS";
  value: string | string[];
}

// --- Query Planning Types ---

export interface MetaApiRequest {
  type: "delivery" | "actions" | "video" | "creative";
  fields: string[];
  breakdowns?: string[];
  actionBreakdowns?: string[];
  level: InsightsLevel;
  timeRange?: TimeRange;
  datePreset?: DatePreset;
  timeIncrement?: TimeIncrement;
  limit?: number;
  attributionWindows?: string[];
  filtering?: Array<{ field: string; operator: string; value: string[] }>;
}

export interface QueryPlan {
  requests: MetaApiRequest[];
  calculatedMetrics: string[];
  joinKeys: string[];
  warnings: string[];
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// --- Calculated Metrics Types ---

export interface DerivedMetrics {
  // Raw API metrics
  hookRate?: number;
  thumbstopRate?: number;
  holdRate?: number;
  completionRate?: number;
  clickToAtcRatio?: number;
  atcToPurchaseRatio?: number;
  clickToPurchaseRatio?: number;
  aov?: number;
  costPerAtc?: number;
  engagementRate?: number;

  // Share/Percentage metrics
  spendShare?: number;
  purchaseValueShare?: number;

  // CTR variants
  outboundCtr?: number;

  // ROAS variants
  subscriptionRoas?: number;
  leadsRoas?: number;

  // Per 1,000 impressions metrics
  purchasesPerMille?: number;
  revenuePerMille?: number;
  installsPerMille?: number;
  leadsPerMille?: number;

  // Engagement rate variants
  impressionsToLeadsRatio?: number;
  likeRate?: number;
  commentRate?: number;
  postShareRatio?: number;
  postEngagementsExclVideo?: number;
  postEngagementRateExclVideo?: number;

  // Video retention metrics
  video15sTo3sRetention?: number;
  thruplayCtr?: number;
  firstFrameRetention?: number;
  thumbstopClickRate?: number;
  costPerMinuteViewed?: number;

  // Video completion rate variants
  videoP25Rate?: number;
  videoP50Rate?: number;
  videoP75Rate?: number;
  videoP95Rate?: number;
  videoP100Rate?: number;

  // Video drop-off metrics
  dropOffP25ToP50?: number;
  dropOffP50ToP75?: number;
  dropOffP75ToP95?: number;
  dropOffP75ToP100?: number;
  dropOffP95ToP100?: number;
  sustainRate?: number;

  // Click quality & funnel metrics
  clickQuality?: number;
  averageLeadsValue?: number;

  // Click to conversion ratios
  clickToAppInstallRatio?: number;
  clickToLeadsRatio?: number;
  clickToSubscriptionsRatio?: number;
  clickToRegistrationsRatio?: number;
  clickToTrialStartedRatio?: number;
  leadsToSubscriptionsRatio?: number;
  clickToContactRatio?: number;
  clickToFindLocationRatio?: number;
  clickToAppointmentsRatio?: number;
  clickToInitiateCheckoutRatio?: number;
  clickToWebsitePurchaseRatio?: number;

  // App funnel metrics
  installToTrialRate?: number;
  installToPurchaseRatio?: number;
  installToRegistrationRate?: number;
  registrationToAchievementRate?: number;
  achievementToPurchaseRate?: number;

  // E-commerce funnel metrics
  viewContentRatio?: number;
  viewContentToAtcRatio?: number;
  checkoutToPurchaseRatio?: number;

  // AOV variants
  aovWebsite?: number;
  aovShop?: number;

  // Cost per action metrics (calculated as spend / count)
  cost_per_page_like?: number;
  cost_per_messaging_conversation?: number;
  cost_per_lead?: number;
  cost_per_purchase?: number;
  cost_per_add_to_cart?: number;
  cost_per_initiate_checkout?: number;
  cost_per_app_install?: number;
  cost_per_landing_page_view?: number;
  cost_per_3s_video_view?: number;
}

// --- OAuth Types ---


export interface MetaAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}


// --- Debug Types ---

export interface QueryDebugInfo {
  requestCount: number;
  rawRequests: MetaApiRequest[];
  calculatedMetrics: string[];
  joinKeys: string[];
  executionTimeMs: number;
  rowCount: number;
  warnings: string[];
  adAccountId?: string;
}

export interface InsightsResponse {
  data: Record<string, unknown>[];
  debug: QueryDebugInfo;
}
