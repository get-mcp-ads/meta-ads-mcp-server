/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// ============================================
// DIMENSION CATALOG
// COMPLETE Entity identifiers and metadata fields
// Based on Meta Marketing API v26.0
// ============================================

/**
 * Dimensions are entity identifiers and metadata fields that provide context about your ads.
 * Unlike metrics (numeric values) or breakdowns (segmentation), dimensions identify
 * WHICH entity (campaign, ad set, ad, creative) the data belongs to.
 * They are essential for data joins, display, and drill-down navigation.
 *
 * This catalog includes ALL available dimensions from Meta API:
 * - Entity IDs and names
 * - Statuses (effective, configured)
 * - Budget information
 * - Timestamps (created, updated, start, end)
 * - Configuration settings
 * - Creative details
 */

export type DimensionCategory =
  | "account"
  | "campaign"
  | "adset"
  | "ad"
  | "creative"
  | "time"
  | "label"
  | "attribution";

export type DimensionType = "string" | "enum" | "array" | "number" | "boolean" | "object";

export type InsightsLevel = "account" | "campaign" | "adset" | "ad";

export interface DimensionDefinition {
  key: string;           // Unique identifier (e.g., "campaign_id")
  apiField: string;      // Meta API field name (same as key for most)
  name: string;          // Display name (e.g., "Campaign ID")
  description: string;   // Full description for tooltips
  category: DimensionCategory;
  type: DimensionType;
  level: InsightsLevel[];  // Which levels return this dimension
  isIdentifier: boolean; // True for ID fields used for joins
  enumValues?: string[]; // Possible values for enum types
  isStatus?: boolean;    // True for status fields
  isBudget?: boolean;    // True for budget fields
  isTimestamp?: boolean; // True for time/date fields
  isInsightsField?: boolean; // False if only available via entity API, not insights (default: true)
}

// ============================================
// DIMENSION CATALOG - COMPLETE
// ============================================

export const DIMENSION_CATALOG: DimensionDefinition[] = [
  // ============================================
  // ACCOUNT DIMENSIONS
  // ============================================
  {
    key: "account_id",
    apiField: "account_id",
    name: "Account ID",
    description: "Unique numeric ID of the ad account. Format: numeric string without 'act_' prefix. Use for data joins across systems. Always returned in insights response.",
    category: "account",
    type: "string",
    level: ["account", "campaign", "adset", "ad"],
    isIdentifier: true,
  },
  {
    key: "account_name",
    apiField: "account_name",
    name: "Account Name",
    description: "The display name configured for the ad account in Business Manager. Useful for multi-account reports.",
    category: "account",
    type: "string",
    level: ["account", "campaign", "adset", "ad"],
    isIdentifier: false,
  },
  {
    key: "account_currency",
    apiField: "account_currency",
    name: "Currency",
    description: "Three-letter ISO currency code (EUR, USD, GBP). All monetary values in the response use this currency. Essential for financial calculations.",
    category: "account",
    type: "string",
    level: ["account", "campaign", "adset", "ad"],
    isIdentifier: false,
  },
  {
    key: "account_timezone_name",
    apiField: "timezone_name",
    name: "Timezone",
    description: "The timezone configured for the ad account (e.g., 'Europe/Paris', 'America/New_York'). Affects how dates are reported.",
    category: "account",
    type: "string",
    level: ["account"],
    isIdentifier: false,
  },
  {
    key: "business_name",
    apiField: "business.name",
    name: "Business Name",
    description: "Name of the Business Manager that owns this ad account. Useful for enterprise multi-business reporting.",
    category: "account",
    type: "string",
    level: ["account"],
    isIdentifier: false,
  },
  {
    key: "business_id",
    apiField: "business.id",
    name: "Business ID",
    description: "Unique ID of the Business Manager that owns this ad account.",
    category: "account",
    type: "string",
    level: ["account"],
    isIdentifier: true,
  },

  // ============================================
  // CAMPAIGN DIMENSIONS
  // ============================================
  {
    key: "campaign_id",
    apiField: "campaign_id",
    name: "Campaign ID",
    description: "Unique numeric ID for the campaign. Primary key for campaign-level data. Use for joins and drill-down navigation.",
    category: "campaign",
    type: "string",
    level: ["campaign", "adset", "ad"],
    isIdentifier: true,
  },
  {
    key: "campaign_name",
    apiField: "campaign_name",
    name: "Campaign Name",
    description: "The display name you set for the campaign in Ads Manager. Displayed to users in reports and tables.",
    category: "campaign",
    type: "string",
    level: ["campaign", "adset", "ad"],
    isIdentifier: false,
  },
  {
    key: "objective",
    apiField: "objective",
    name: "Objective",
    description: "Campaign optimization goal determining what Meta optimizes for. Values: OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_APP_PROMOTION, OUTCOME_TRAFFIC.",
    category: "campaign",
    type: "enum",
    level: ["campaign", "adset", "ad"],
    isIdentifier: false,
    enumValues: [
      "OUTCOME_AWARENESS",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_LEADS",
      "OUTCOME_SALES",
      "OUTCOME_APP_PROMOTION",
      "OUTCOME_TRAFFIC"
    ],
  },
  {
    key: "buying_type",
    apiField: "buying_type",
    name: "Buying Type",
    description: "Purchase method: AUCTION (standard bidding) or RESERVED (guaranteed delivery). Most campaigns use AUCTION.",
    category: "campaign",
    type: "enum",
    level: ["campaign", "adset", "ad"],
    isIdentifier: false,
    enumValues: ["AUCTION", "RESERVED"],
  },
  {
    key: "campaign_effective_status",
    apiField: "effective_status",
    name: "Campaign Status (Effective)",
    description: "Computed campaign status considering parent and system states. Values: ACTIVE, PAUSED, DELETED, ARCHIVED, IN_PROCESS, WITH_ISSUES. This reflects actual delivery state.",
    category: "campaign",
    type: "enum",
    level: ["campaign"],
    isIdentifier: false,
    isStatus: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
    enumValues: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED"],
  },
  {
    key: "campaign_status",
    apiField: "status",
    name: "Campaign Status (Configured)",
    description: "The status you configured for the campaign: ACTIVE, PAUSED, DELETED, ARCHIVED. Does not reflect system-level pausing.",
    category: "campaign",
    type: "enum",
    level: ["campaign"],
    isIdentifier: false,
    isStatus: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
    enumValues: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
  },
  {
    key: "campaign_daily_budget",
    apiField: "daily_budget",
    name: "Campaign Daily Budget",
    description: "Daily spending limit for the campaign in account currency (in cents). Divide by 100 for display value.",
    category: "campaign",
    type: "number",
    level: ["campaign"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_lifetime_budget",
    apiField: "lifetime_budget",
    name: "Campaign Lifetime Budget",
    description: "Total budget for the campaign lifetime in account currency (in cents). Used for campaign budget optimization.",
    category: "campaign",
    type: "number",
    level: ["campaign"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_budget_remaining",
    apiField: "budget_remaining",
    name: "Campaign Budget Remaining",
    description: "Remaining budget to spend (lifetime budgets only). In cents.",
    category: "campaign",
    type: "number",
    level: ["campaign"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_spend_cap",
    apiField: "spend_cap",
    name: "Campaign Spend Cap",
    description: "Maximum amount the campaign can spend in total. In cents.",
    category: "campaign",
    type: "number",
    level: ["campaign"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_start_time",
    apiField: "start_time",
    name: "Campaign Start Time",
    description: "Scheduled start time for the campaign in ISO 8601 format.",
    category: "campaign",
    type: "string",
    level: ["campaign"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_stop_time",
    apiField: "stop_time",
    name: "Campaign End Time",
    description: "Scheduled end time for the campaign in ISO 8601 format. Null if no end date set.",
    category: "campaign",
    type: "string",
    level: ["campaign"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_created_time",
    apiField: "created_time",
    name: "Campaign Created",
    description: "When the campaign was created in ISO 8601 format.",
    category: "campaign",
    type: "string",
    level: ["campaign"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "campaign_updated_time",
    apiField: "updated_time",
    name: "Campaign Updated",
    description: "When the campaign was last modified in ISO 8601 format.",
    category: "campaign",
    type: "string",
    level: ["campaign"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "special_ad_categories",
    apiField: "special_ad_categories",
    name: "Special Ad Categories",
    description: "Special categories requiring additional restrictions: HOUSING, EMPLOYMENT, CREDIT, SOCIAL_ISSUES_ELECTIONS_OR_POLITICS. Empty array if none.",
    category: "campaign",
    type: "array",
    level: ["campaign"],
    isIdentifier: false,
    isInsightsField: false, // Requires Campaign entity API, not Insights
    enumValues: ["HOUSING", "EMPLOYMENT", "CREDIT", "SOCIAL_ISSUES_ELECTIONS_OR_POLITICS", "NONE"],
  },
  {
    key: "campaign_bid_strategy",
    apiField: "bid_strategy",
    name: "Campaign Bid Strategy",
    description: "Campaign-level bid strategy when using campaign budget optimization (CBO).",
    category: "campaign",
    type: "enum",
    level: ["campaign"],
    isIdentifier: false,
    isInsightsField: false, // Requires Campaign entity API, not Insights
    enumValues: ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"],
  },
  {
    key: "source_campaign_id",
    apiField: "source_campaign_id",
    name: "Source Campaign ID",
    description: "ID of the original campaign if this was duplicated. Useful for tracking copies.",
    category: "campaign",
    type: "string",
    level: ["campaign"],
    isIdentifier: true,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },
  {
    key: "smart_promotion_type",
    apiField: "smart_promotion_type",
    name: "Smart Promotion Type",
    description: "Type of smart promotion if enabled: GUIDED_CREATION, SMART_APP_PROMOTION.",
    category: "campaign",
    type: "enum",
    level: ["campaign"],
    isIdentifier: false,
    isInsightsField: false, // Requires Campaign entity API, not Insights
    enumValues: ["GUIDED_CREATION", "SMART_APP_PROMOTION"],
  },

  // ============================================
  // AD SET DIMENSIONS
  // ============================================
  {
    key: "adset_id",
    apiField: "adset_id",
    name: "Ad Set ID",
    description: "Unique numeric ID for the ad set. Primary key for ad set-level data. Links to parent campaign via campaign_id.",
    category: "adset",
    type: "string",
    level: ["adset", "ad"],
    isIdentifier: true,
  },
  {
    key: "adset_name",
    apiField: "adset_name",
    name: "Ad Set Name",
    description: "The display name you set for the ad set. Contains targeting and budget context.",
    category: "adset",
    type: "string",
    level: ["adset", "ad"],
    isIdentifier: false,
  },
  {
    key: "optimization_goal",
    apiField: "optimization_goal",
    name: "Optimization Goal",
    description: "What Meta optimizes ad delivery for at the ad set level. Values: LINK_CLICKS, IMPRESSIONS, CONVERSIONS, REACH, LANDING_PAGE_VIEWS, OFFSITE_CONVERSIONS, VALUE, etc.",
    category: "adset",
    type: "enum",
    level: ["adset", "ad"],
    isIdentifier: false,
    enumValues: [
      "NONE",
      "APP_INSTALLS",
      "AD_RECALL_LIFT",
      "ENGAGED_USERS",
      "EVENT_RESPONSES",
      "IMPRESSIONS",
      "LEAD_GENERATION",
      "QUALITY_LEAD",
      "LINK_CLICKS",
      "OFFSITE_CONVERSIONS",
      "PAGE_LIKES",
      "POST_ENGAGEMENT",
      "QUALITY_CALL",
      "REACH",
      "LANDING_PAGE_VIEWS",
      "VISIT_INSTAGRAM_PROFILE",
      "VALUE",
      "THRUPLAY",
      "DERIVED_EVENTS",
      "APP_INSTALLS_AND_OFFSITE_CONVERSIONS",
      "CONVERSATIONS",
      "IN_APP_VALUE",
      "MESSAGING_PURCHASE_CONVERSION",
      "MESSAGING_APPOINTMENT_CONVERSION",
      "SUBSCRIBERS"
    ],
  },
  {
    key: "bid_strategy",
    apiField: "bid_strategy",
    name: "Bid Strategy",
    description: "How Meta bids in the auction for this ad set. Values: LOWEST_COST_WITHOUT_CAP (auto), LOWEST_COST_WITH_BID_CAP, COST_CAP, MINIMUM_ROAS.",
    category: "adset",
    type: "enum",
    level: ["adset", "ad"],
    isIdentifier: false,
    enumValues: [
      "LOWEST_COST_WITHOUT_CAP",
      "LOWEST_COST_WITH_BID_CAP",
      "COST_CAP",
      "LOWEST_COST_WITH_MIN_ROAS"
    ],
  },
  {
    key: "bid_amount",
    apiField: "bid_amount",
    name: "Bid Amount",
    description: "The bid amount in cents when using bid cap or cost cap.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "budget_remaining",
    apiField: "budget_remaining",
    name: "Budget Remaining",
    description: "Amount of budget left to spend (lifetime budgets only). Null for daily budgets.",
    category: "adset",
    type: "string",
    level: ["adset", "ad"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "adset_effective_status",
    apiField: "effective_status",
    name: "Ad Set Status (Effective)",
    description: "Computed status considering campaign and system states. Values: ACTIVE, PAUSED, DELETED, ARCHIVED, CAMPAIGN_PAUSED, WITH_ISSUES.",
    category: "adset",
    type: "enum",
    level: ["adset"],
    isIdentifier: false,
    isStatus: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
    enumValues: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES"],
  },
  {
    key: "adset_status",
    apiField: "status",
    name: "Ad Set Status (Configured)",
    description: "The status you configured for the ad set: ACTIVE, PAUSED, DELETED, ARCHIVED.",
    category: "adset",
    type: "enum",
    level: ["adset"],
    isIdentifier: false,
    isStatus: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
    enumValues: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
  },
  {
    key: "adset_daily_budget",
    apiField: "daily_budget",
    name: "Ad Set Daily Budget",
    description: "Daily spending limit for the ad set in cents.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "adset_lifetime_budget",
    apiField: "lifetime_budget",
    name: "Ad Set Lifetime Budget",
    description: "Total budget for the ad set lifetime in cents.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "adset_start_time",
    apiField: "start_time",
    name: "Ad Set Start Time",
    description: "Scheduled start time for the ad set in ISO 8601 format.",
    category: "adset",
    type: "string",
    level: ["adset"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "adset_end_time",
    apiField: "end_time",
    name: "Ad Set End Time",
    description: "Scheduled end time for the ad set in ISO 8601 format. Null if no end date set.",
    category: "adset",
    type: "string",
    level: ["adset"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "adset_created_time",
    apiField: "created_time",
    name: "Ad Set Created",
    description: "When the ad set was created in ISO 8601 format.",
    category: "adset",
    type: "string",
    level: ["adset"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "adset_updated_time",
    apiField: "updated_time",
    name: "Ad Set Updated",
    description: "When the ad set was last modified in ISO 8601 format.",
    category: "adset",
    type: "string",
    level: ["adset"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "billing_event",
    apiField: "billing_event",
    name: "Billing Event",
    description: "Event that triggers billing: IMPRESSIONS, LINK_CLICKS, APP_INSTALLS, PAGE_LIKES, POST_ENGAGEMENT, VIDEO_VIEWS, THRUPLAY.",
    category: "adset",
    type: "enum",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
    enumValues: ["APP_INSTALLS", "IMPRESSIONS", "LINK_CLICKS", "NONE", "OFFER_CLAIMS", "PAGE_LIKES", "POST_ENGAGEMENT", "THRUPLAY", "PURCHASE", "LISTING_INTERACTION"],
  },
  {
    key: "destination_type",
    apiField: "destination_type",
    name: "Destination Type",
    description: "Where users are sent: WEBSITE, APP, MESSENGER, INSTAGRAM_DIRECT, WHATSAPP, APPLINKS_AUTOMATIC, FACEBOOK.",
    category: "adset",
    type: "enum",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
    enumValues: ["UNDEFINED", "WEBSITE", "APP", "MESSENGER", "APPLINKS_AUTOMATIC", "FACEBOOK", "INSTAGRAM_DIRECT", "WHATSAPP", "SHOP_AUTOMATIC", "ON_AD", "ON_POST", "ON_VIDEO", "ON_PAGE", "ON_EVENT", "IG_SHOPPING"],
  },
  {
    key: "promoted_object",
    apiField: "promoted_object",
    name: "Promoted Object",
    description: "The object being promoted: pixel_id, application_id, page_id, custom_event_type, etc.",
    category: "adset",
    type: "object",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "targeting_optimization_types",
    apiField: "targeting_optimization_types",
    name: "Targeting Optimization",
    description: "Types of targeting optimization enabled: NONE, EXPANSION_ALL, TARGETING_EXPANSION, LOOKALIKE_EXPANSION.",
    category: "adset",
    type: "array",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "attribution_spec",
    apiField: "attribution_spec",
    name: "Attribution Spec",
    description: "Attribution window configuration for this ad set.",
    category: "adset",
    type: "object",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "use_new_app_click",
    apiField: "use_new_app_click",
    name: "Use New App Click",
    description: "Whether the ad set uses new app click attribution.",
    category: "adset",
    type: "boolean",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "source_adset_id",
    apiField: "source_adset_id",
    name: "Source Ad Set ID",
    description: "ID of the original ad set if this was duplicated.",
    category: "adset",
    type: "string",
    level: ["adset"],
    isIdentifier: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "pacing_type",
    apiField: "pacing_type",
    name: "Pacing Type",
    description: "How the budget is paced: standard, day_parting, no_pacing.",
    category: "adset",
    type: "array",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "lifetime_imps",
    apiField: "lifetime_imps",
    name: "Lifetime Impressions Cap",
    description: "Maximum number of impressions for lifetime. Used for reach objectives.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "daily_min_spend_target",
    apiField: "daily_min_spend_target",
    name: "Daily Min Spend Target",
    description: "Minimum daily spend target in cents.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "daily_spend_cap",
    apiField: "daily_spend_cap",
    name: "Daily Spend Cap",
    description: "Maximum daily spend in cents.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "lifetime_spend_cap",
    apiField: "lifetime_spend_cap",
    name: "Lifetime Spend Cap",
    description: "Maximum lifetime spend in cents.",
    category: "adset",
    type: "number",
    level: ["adset"],
    isIdentifier: false,
    isBudget: true,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },

  // ============================================
  // AD DIMENSIONS
  // ============================================
  {
    key: "ad_id",
    apiField: "ad_id",
    name: "Ad ID",
    description: "Unique numeric ID for the individual ad. Primary key for ad-level data. Links to creative via creative field.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: true,
  },
  {
    key: "ad_name",
    apiField: "ad_name",
    name: "Ad Name",
    description: "The display name you set for the ad. Often contains creative variant information.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
  },
  {
    key: "ad_effective_status",
    apiField: "effective_status",
    name: "Ad Status (Effective)",
    description: "Computed status considering parent states: ACTIVE, PAUSED, DELETED, ARCHIVED, CAMPAIGN_PAUSED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES, PENDING_REVIEW, DISAPPROVED.",
    category: "ad",
    type: "enum",
    level: ["ad"],
    isIdentifier: false,
    isStatus: true,
    isInsightsField: false, // Requires Ad entity API, not Insights
    enumValues: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PENDING_BILLING_INFO", "PREAPPROVED"],
  },
  {
    key: "ad_status",
    apiField: "status",
    name: "Ad Status (Configured)",
    description: "The status you configured for the ad: ACTIVE, PAUSED, DELETED, ARCHIVED.",
    category: "ad",
    type: "enum",
    level: ["ad"],
    isIdentifier: false,
    isStatus: true,
    isInsightsField: false, // Requires Ad entity API, not Insights
    enumValues: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
  },
  {
    key: "ad_created_time",
    apiField: "created_time",
    name: "Ad Created",
    description: "When the ad was created in ISO 8601 format.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "ad_updated_time",
    apiField: "updated_time",
    name: "Ad Updated",
    description: "When the ad was last modified in ISO 8601 format.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isTimestamp: true,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "preview_shareable_link",
    apiField: "preview_shareable_link",
    name: "Preview Link",
    description: "Shareable URL to preview the ad before it's live.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "source_ad_id",
    apiField: "source_ad_id",
    name: "Source Ad ID",
    description: "ID of the original ad if this was duplicated.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: true,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "tracking_specs",
    apiField: "tracking_specs",
    name: "Tracking Specs",
    description: "Tracking configuration for the ad including pixels and events.",
    category: "ad",
    type: "object",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "conversion_domain",
    apiField: "conversion_domain",
    name: "Conversion Domain",
    description: "Primary domain for conversion tracking. Used for iOS 14+ attribution.",
    category: "ad",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "bid_type",
    apiField: "bid_type",
    name: "Bid Type",
    description: "Type of bid for this ad: CPC, CPM, ABSOLUTE_OCPM, etc.",
    category: "ad",
    type: "enum",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
    enumValues: ["CPC", "CPM", "ABSOLUTE_OCPM", "MULTI_PREMIUM"],
  },
  {
    key: "ad_review_feedback",
    apiField: "ad_review_feedback",
    name: "Review Feedback",
    description: "Feedback from Meta's ad review process if the ad was disapproved or has issues.",
    category: "ad",
    type: "object",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },

  // ============================================
  // CREATIVE DIMENSIONS
  // All creative fields require Ad entity API, not Insights
  // ============================================
  {
    key: "creative_id",
    apiField: "creative.id",
    name: "Creative ID",
    description: "ID of the creative object associated with this ad. Use to fetch full creative details via /adcreatives endpoint.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: true,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_name",
    apiField: "creative.name",
    name: "Creative Name",
    description: "Name of the creative object. May be auto-generated if not explicitly set.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_title",
    apiField: "creative.title",
    name: "Creative Title",
    description: "The headline/title text of the creative.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_body",
    apiField: "creative.body",
    name: "Creative Body",
    description: "The primary text/body copy of the creative.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_call_to_action_type",
    apiField: "creative.call_to_action_type",
    name: "CTA Type",
    description: "Call-to-action button type: SHOP_NOW, LEARN_MORE, SIGN_UP, DOWNLOAD, etc.",
    category: "creative",
    type: "enum",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
    enumValues: ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "DOWNLOAD", "GET_OFFER", "CONTACT_US", "BOOK_NOW", "WATCH_MORE", "APPLY_NOW", "GET_QUOTE", "SUBSCRIBE", "DONATE_NOW", "ORDER_NOW", "ADD_TO_CART", "BUY_NOW", "MESSAGE_PAGE", "WHATSAPP_MESSAGE", "CALL_NOW", "GET_DIRECTIONS", "SEND_MESSAGE"],
  },
  {
    key: "creative_link_url",
    apiField: "creative.link_url",
    name: "Creative Link URL",
    description: "The destination URL when users click the creative.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_thumbnail_url",
    apiField: "creative.thumbnail_url",
    name: "Thumbnail URL",
    description: "URL of the creative's thumbnail image.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_image_url",
    apiField: "creative.image_url",
    name: "Image URL",
    description: "URL of the main image for image creatives.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_video_id",
    apiField: "creative.video_id",
    name: "Video ID",
    description: "ID of the video asset for video creatives.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: true,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_object_type",
    apiField: "creative.object_type",
    name: "Creative Object Type",
    description: "Type of creative: VIDEO, PHOTO, CAROUSEL, STATUS, OFFER, etc.",
    category: "creative",
    type: "enum",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
    enumValues: ["APPLICATION", "DOMAIN", "EVENT", "INVALID", "OFFER", "PAGE", "PHOTO", "POST_DELETED", "PRIVACY_CHECK_FAIL", "SHARE", "STATUS", "STORE_ITEM", "VIDEO"],
  },
  {
    key: "creative_effective_object_story_id",
    apiField: "creative.effective_object_story_id",
    name: "Story ID",
    description: "ID of the Page post used for the ad, in format 'page_id_post_id'.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: true,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_object_story_spec",
    apiField: "creative.object_story_spec",
    name: "Story Spec",
    description: "Specification for creating a new post for the ad.",
    category: "creative",
    type: "object",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_image_hash",
    apiField: "creative.image_hash",
    name: "Image Hash",
    description: "Hash identifier of the image asset.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_instagram_actor_id",
    apiField: "creative.instagram_actor_id",
    name: "Instagram Actor ID",
    description: "ID of the Instagram account used for the ad.",
    category: "creative",
    type: "string",
    level: ["ad"],
    isIdentifier: true,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_is_dynamic_creative",
    apiField: "creative.use_page_actor_override",
    name: "Is Dynamic Creative",
    description: "Whether this creative uses Dynamic Creative optimization.",
    category: "creative",
    type: "boolean",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },
  {
    key: "creative_asset_feed_spec",
    apiField: "creative.asset_feed_spec",
    name: "Asset Feed Spec",
    description: "Dynamic Creative asset feed specification with multiple images/videos/texts.",
    category: "creative",
    type: "object",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API with creative expansion
  },

  // ============================================
  // TIME DIMENSIONS
  // ============================================
  {
    key: "date_start",
    apiField: "date_start",
    name: "Date Start",
    description: "First day of the reporting period in YYYY-MM-DD format. Always present in insights response. Use for time-series grouping.",
    category: "time",
    type: "string",
    level: ["account", "campaign", "adset", "ad"],
    isIdentifier: false,
    isTimestamp: true,
  },
  {
    key: "date_stop",
    apiField: "date_stop",
    name: "Date Stop",
    description: "Last day of the reporting period in YYYY-MM-DD format. Always present. With date_start, defines the row's time window.",
    category: "time",
    type: "string",
    level: ["account", "campaign", "adset", "ad"],
    isIdentifier: false,
    isTimestamp: true,
  },

  // ============================================
  // LABEL DIMENSIONS
  // All label fields require entity API, not Insights
  // ============================================
  {
    key: "labels",
    apiField: "labels",
    name: "Labels",
    description: "Custom labels applied for organization. Array of label names. Useful for custom categorization and filtering.",
    category: "label",
    type: "array",
    level: ["campaign", "adset", "ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires entity API, not Insights
  },
  {
    key: "ad_labels",
    apiField: "ad_labels",
    name: "Ad Labels",
    description: "Detailed ad labels with full metadata including id, name, created_time. More detailed than simple labels array.",
    category: "label",
    type: "array",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "adset_labels",
    apiField: "labels",
    name: "Ad Set Labels",
    description: "Labels applied to the ad set for organization.",
    category: "label",
    type: "array",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
  },
  {
    key: "campaign_labels",
    apiField: "labels",
    name: "Campaign Labels",
    description: "Labels applied to the campaign for organization.",
    category: "label",
    type: "array",
    level: ["campaign"],
    isIdentifier: false,
    isInsightsField: false, // Requires Campaign entity API, not Insights
  },

  // ============================================
  // ATTRIBUTION DIMENSIONS
  // ============================================
  {
    key: "attribution_setting",
    apiField: "attribution_setting",
    name: "Attribution Setting",
    description: "Current attribution window setting for conversions.",
    category: "attribution",
    type: "enum",
    level: ["adset"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad Set entity API, not Insights
    enumValues: ["1d_click", "7d_click", "28d_click", "1d_view", "7d_view", "28d_view", "1d_ev", "default"],
  },
  {
    key: "conversion_specs",
    apiField: "conversion_specs",
    name: "Conversion Specs",
    description: "Specifications for tracked conversions.",
    category: "attribution",
    type: "object",
    level: ["ad"],
    isIdentifier: false,
    isInsightsField: false, // Requires Ad entity API, not Insights
  },
  {
    key: "action_attribution_windows",
    apiField: "action_attribution_windows",
    name: "Action Attribution Windows",
    description: "Attribution windows used for this data: 1d_click, 7d_click, 1d_view, etc.",
    category: "attribution",
    type: "array",
    level: ["account", "campaign", "adset", "ad"],
    isIdentifier: false,
    isInsightsField: false, // This is a request parameter, not a response field
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get dimensions available for a specific insights level
 */
export function getDimensionsByLevel(level: InsightsLevel): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.level.includes(level));
}

/**
 * Get only dimensions that are available via the Insights API
 * Filters out entity-only fields (budgets, statuses, timestamps, creatives, etc.)
 */
export function getInsightsDimensions(): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.isInsightsField !== false);
}

/**
 * Get insights-compatible dimensions for a specific level
 */
export function getInsightsDimensionsByLevel(level: InsightsLevel): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.level.includes(level) && d.isInsightsField !== false);
}

/**
 * Check if a dimension is available via the Insights API
 */
export function isDimensionInsightsField(key: string): boolean {
  const dim = DIMENSION_CATALOG.find(d => d.key === key);
  return dim?.isInsightsField !== false;
}

/**
 * Filter dimension keys to only include insights-compatible fields
 */
export function filterInsightsDimensionKeys(keys: string[]): string[] {
  return keys.filter(key => isDimensionInsightsField(key));
}

/**
 * Get dimensions by category
 */
export function getDimensionsByCategory(category: DimensionCategory): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.category === category);
}

/**
 * Get only identifier dimensions (used for joins)
 */
export function getIdentifierDimensions(): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.isIdentifier);
}

/**
 * Get only status dimensions
 */
export function getStatusDimensions(): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.isStatus);
}

/**
 * Get only budget-related dimensions
 */
export function getBudgetDimensions(): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.isBudget);
}

/**
 * Get only timestamp dimensions
 */
export function getTimestampDimensions(): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.isTimestamp);
}

/**
 * Convert dimension keys to API field names
 */
export function getDimensionApiFields(dimensionKeys: string[]): string[] {
  return dimensionKeys.map(key => {
    const dim = DIMENSION_CATALOG.find(d => d.key === key);
    return dim?.apiField || key;
  });
}

/**
 * Find a dimension by its key
 */
export function getDimensionByKey(key: string): DimensionDefinition | undefined {
  return DIMENSION_CATALOG.find(d => d.key === key);
}

/**
 * Get ALL dimensions for a specific level (including entity-only fields)
 */
export function getAllDimensionsByLevel(level: InsightsLevel): DimensionDefinition[] {
  return DIMENSION_CATALOG.filter(d => d.level.includes(level));
}

/**
 * Get entity-only dimension keys (fields that require entity API, not available via Insights)
 */
export function getEntityOnlyDimensionKeys(dimensionKeys: string[]): string[] {
  return dimensionKeys.filter(key => {
    const dim = DIMENSION_CATALOG.find(d => d.key === key);
    return dim && dim.isInsightsField === false;
  });
}

/**
 * Get the entity ID field name for a given dimension category
 * Used to know which ID to use when fetching entity metadata
 */
export function getEntityIdField(category: DimensionCategory): string | null {
  switch (category) {
    case "ad": return "ad_id";
    case "adset": return "adset_id";
    case "campaign": return "campaign_id";
    case "account": return "account_id";
    default: return null;
  }
}

/**
 * Get default dimensions for a level (commonly used identifiers + names)
 */
export function getDefaultDimensionsForLevel(level: InsightsLevel): string[] {
  const defaults: Record<InsightsLevel, string[]> = {
    account: ["account_id", "account_name", "account_currency", "date_start", "date_stop"],
    campaign: ["campaign_id", "campaign_name", "objective", "campaign_effective_status", "date_start", "date_stop"],
    adset: ["adset_id", "adset_name", "campaign_id", "campaign_name", "adset_effective_status", "date_start", "date_stop"],
    ad: ["ad_id", "ad_name", "adset_id", "campaign_id", "ad_effective_status", "creative_id", "date_start", "date_stop"],
  };
  return defaults[level];
}

/**
 * Category display information for UI
 */
export const DIMENSION_CATEGORIES = {
  account: {
    name: "Account",
    description: "Ad account identifiers and settings",
    icon: "building",
  },
  campaign: {
    name: "Campaign",
    description: "Campaign identifiers and configuration",
    icon: "target",
  },
  adset: {
    name: "Ad Set",
    description: "Ad set identifiers, budgets, and targeting settings",
    icon: "layers",
  },
  ad: {
    name: "Ad",
    description: "Individual ad identifiers and status",
    icon: "image",
  },
  creative: {
    name: "Creative",
    description: "Creative content details (text, images, videos)",
    icon: "palette",
  },
  time: {
    name: "Time",
    description: "Date and time period information",
    icon: "calendar",
  },
  label: {
    name: "Labels",
    description: "Custom organization labels",
    icon: "tag",
  },
  attribution: {
    name: "Attribution",
    description: "Conversion attribution settings and windows",
    icon: "git-branch",
  },
} as const;

// Export count for reference
export const DIMENSION_COUNT = DIMENSION_CATALOG.length;
