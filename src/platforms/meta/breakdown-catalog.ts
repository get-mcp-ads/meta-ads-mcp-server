/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// ============================================
// META MARKETING API BREAKDOWN CATALOG
// Complete breakdown definitions for Meta insights reporting
// ============================================

import type { BreakdownDefinition, BreakdownCategory } from "./types.js";
export type { BreakdownDefinition, BreakdownCategory } from "./types.js";

/**
 * Complete catalog of Meta Marketing API breakdowns (dimensions)
 * Based on Meta Marketing API v26.0
 */
export const BREAKDOWN_CATALOG: BreakdownDefinition[] = [
  // ============================================
  // DEMOGRAPHIC BREAKDOWNS
  // ============================================
  {
    key: "age",
    name: "Age",
    description:
      "Age group segmentation. Splits performance by age bracket: 13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+. Essential for understanding which generations respond to your ads.",
    category: "demographic",
    possibleValues: [
      "13-17",
      "18-24",
      "25-34",
      "35-44",
      "45-54",
      "55-64",
      "65+",
    ],
    historicalLimit: 13, // months with reach metrics
  },
  {
    key: "gender",
    name: "Gender",
    description:
      "Gender segmentation. Splits performance by gender: male, female, unknown. 'Unknown' includes users who haven't specified or non-binary.",
    category: "demographic",
    possibleValues: ["male", "female", "unknown"],
    historicalLimit: 13,
  },

  // ============================================
  // AUDIENCE BREAKDOWNS
  // ============================================
  {
    key: "user_segment_key",
    name: "User Segment (ASC)",
    description:
      "User segment (new, existing) of Advantage+ Shopping Campaigns (ASC). Existing user is specified by the custom audience in ASC settings. Also works with other Advantage+ campaigns showing audience relationship: new audience, engaged audience, existing customers.",
    category: "audience",
    possibleValues: [
      "new",
      "existing",
      "new_audience",
      "engaged_audience",
      "existing_customers",
      "unknown",
    ],
  },

  // ============================================
  // GEOGRAPHIC BREAKDOWNS
  // ============================================
  {
    key: "country",
    name: "Country",
    description:
      "Country-level performance using ISO codes (US, FR, GB, DE, etc.). Essential for international campaigns and market analysis.",
    category: "geographic",
    historicalLimit: 13,
  },
  {
    key: "region",
    name: "Region",
    description:
      "Region/state-level performance. More granular than country. Useful for localized campaigns and regional promotions.",
    category: "geographic",
    historicalLimit: 13,
    blocksOffsiteMetrics: true,
  },
  {
    key: "dma",
    name: "DMA (Designated Market Area)",
    description:
      "US-only Nielsen market zones. Used for local TV-aligned advertising and regional US campaigns.",
    category: "geographic",
    historicalLimit: 13,
    blocksOffsiteMetrics: true,
  },

  // ============================================
  // PLATFORM & PLACEMENT BREAKDOWNS
  // ============================================
  {
    key: "publisher_platform",
    name: "Publisher Platform",
    description:
      "Which Meta platform showed your ad: facebook, instagram, audience_network, messenger, whatsapp. Compare cross-platform performance.",
    category: "platform",
    possibleValues: [
      "facebook",
      "instagram",
      "audience_network",
      "messenger",
      "whatsapp",
    ],
  },
  {
    key: "platform_position",
    name: "Platform Position",
    description:
      "Specific placement within platforms: feed, story, reels, explore, search, marketplace, video_feeds, instream_video, right_hand_column, instant_article, etc.",
    category: "platform",
    possibleValues: [
      "feed",
      "story",
      "reels",
      "explore",
      "search",
      "marketplace",
      "video_feeds",
      "instream_video",
      "right_hand_column",
      "instant_article",
      "rewarded_video",
      "an_classic",
      "biz_disco_feed",
      "facebook_reels_overlay",
      "profile_feed",
    ],
    requiresCombination: ["publisher_platform"],
  },
  {
    key: "device_platform",
    name: "Device Platform",
    description:
      "Performance by device type: mobile, desktop, tablet. Understand device preferences of your audience.",
    category: "platform",
    possibleValues: ["mobile", "desktop", "tablet"],
  },
  {
    key: "impression_device",
    name: "Impression Device",
    description:
      "More detailed device breakdown: desktop, mobile_app, mobile_web, unknown. Cannot be used alone, must combine with other breakdowns.",
    category: "platform",
    possibleValues: ["desktop", "mobile_app", "mobile_web", "unknown"],
    requiresCombination: ["publisher_platform"],
  },

  // ============================================
  // CREATIVE BREAKDOWNS (Ad Level Only)
  // ============================================
  {
    key: "image_asset",
    name: "Image Asset",
    description:
      "Compare different images in dynamic creative ads. Returns asset ID, name, URL, and hash for identification.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "video_asset",
    name: "Video Asset",
    description:
      "Compare different videos in dynamic creative. Returns video_id, thumbnail_url for identification.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "body_asset",
    name: "Body Asset (Primary Text)",
    description:
      "Compare different ad copy variations. Returns asset ID and full text content.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "title_asset",
    name: "Title Asset (Headline)",
    description:
      "Compare headline variations. Returns asset ID and text. Critical for click-through optimization.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "description_asset",
    name: "Description Asset",
    description:
      "Compare link description variations that appear below headlines on some placements.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "call_to_action_asset",
    name: "Call to Action Asset",
    description:
      "Compare different CTA buttons: Shop Now, Learn More, Sign Up, Download, Contact Us, etc.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "link_url_asset",
    name: "Link URL Asset",
    description:
      "Compare results by destination URL. Essential for landing page A/B testing.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "ad_format_asset",
    name: "Ad Format Asset",
    description:
      "Compare creative format effectiveness: IMAGE, VIDEO, CAROUSEL, COLLECTION, SLIDESHOW.",
    category: "creative",
    possibleValues: ["IMAGE", "VIDEO", "CAROUSEL", "COLLECTION", "SLIDESHOW"],
    levelRestrictions: ["ad"],
  },
  {
    key: "media_type",
    name: "Media Type",
    description: "Broader categorization of creative media: image, video, link, share.",
    category: "creative",
    possibleValues: ["image", "video", "link", "share"],
    levelRestrictions: ["ad"],
  },
  {
    key: "media_format",
    name: "Media Format",
    description: "Specific format of the media creative.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "flexible_format_asset_type",
    name: "Flexible Format Asset Type",
    description: "Type of asset in flexible format creative optimization.",
    category: "creative",
    levelRestrictions: ["ad"],
  },
  {
    key: "gen_ai_asset_type",
    name: "AI Generated Asset Type",
    description:
      "Identifies assets created by Meta's AI tools. Compare AI vs human-created content performance.",
    category: "creative",
    possibleValues: ["ai_generated_image", "ai_generated_text"],
    levelRestrictions: ["ad"],
  },

  // ============================================
  // PRODUCT BREAKDOWNS (Catalog/DPA)
  // ============================================
  {
    key: "product_id",
    name: "Product ID",
    description:
      "Performance by specific product ID from your catalog. Essential for dynamic product ads optimization.",
    category: "product",
    blocksOffsiteMetrics: true,
  },
  {
    key: "product_brand_breakdown",
    name: "Product Brand",
    description:
      "Aggregate performance by brand in your product catalog. Useful for multi-brand retailers.",
    category: "product",
  },
  {
    key: "product_category_breakdown",
    name: "Product Category",
    description:
      "Results by product category (electronics, clothing, etc.). Identify best-performing product types.",
    category: "product",
  },
  {
    key: "product_type_breakdown",
    name: "Product Type",
    description:
      "More granular than category. Custom product typing from your catalog.",
    category: "product",
  },
  {
    key: "product_custom_label_0_breakdown",
    name: "Product Custom Label 0",
    description:
      "Your custom catalog labels. Use for margin tiers, seasonality, promo eligibility, or any business-specific grouping.",
    category: "product",
  },
  {
    key: "product_custom_label_1_breakdown",
    name: "Product Custom Label 1",
    description: "Custom label 1 from your product catalog.",
    category: "product",
  },
  {
    key: "product_custom_label_2_breakdown",
    name: "Product Custom Label 2",
    description: "Custom label 2 from your product catalog.",
    category: "product",
  },
  {
    key: "product_custom_label_3_breakdown",
    name: "Product Custom Label 3",
    description: "Custom label 3 from your product catalog.",
    category: "product",
  },
  {
    key: "product_custom_label_4_breakdown",
    name: "Product Custom Label 4",
    description: "Custom label 4 from your product catalog.",
    category: "product",
  },
  {
    key: "product_group_content_id_breakdown",
    name: "Product Group ID",
    description:
      "Performance by product group ID. Useful for analyzing variant performance (sizes, colors).",
    category: "product",
  },

  // ============================================
  // TIME BREAKDOWNS
  // ============================================
  {
    key: "hourly_stats_aggregated_by_advertiser_time_zone",
    name: "Hourly (Advertiser Timezone)",
    description:
      "Hour-of-day performance in your account's timezone. Identify peak performance times for ad scheduling.",
    category: "time",
    historicalLimit: 13,
    blocksOffsiteMetrics: true,
  },
  {
    key: "hourly_stats_aggregated_by_audience_time_zone",
    name: "Hourly (Audience Timezone)",
    description:
      "Hour-of-day performance in your audience's local timezone. Better for understanding actual user behavior patterns.",
    category: "time",
    historicalLimit: 13,
    blocksOffsiteMetrics: true,
  },
  {
    key: "frequency_value",
    name: "Frequency Value",
    description:
      "Performance by exact impression count (1, 2, 3... times seen). Analyze frequency saturation and optimal exposure levels.",
    category: "time",
    historicalLimit: 6,
  },

  // ============================================
  // ACTION BREAKDOWNS
  // ============================================
  {
    key: "action_type",
    name: "Action Type",
    description:
      "Default action breakdown. Segments actions/conversions by their type (purchase, lead, add_to_cart, etc.).",
    category: "action",
  },
  {
    key: "action_device",
    name: "Action Device",
    description:
      "Device where the conversion occurred: desktop, iphone, ipad, android_smartphone, android_tablet, other.",
    category: "action",
    possibleValues: [
      "desktop",
      "iphone",
      "ipad",
      "android_smartphone",
      "android_tablet",
      "other",
    ],
    blocksOffsiteMetrics: true,
  },
  {
    key: "action_destination",
    name: "Action Destination",
    description:
      "Where the action happened: website, app, messenger, instagram_direct, whatsapp, facebook, applinks_deeplink.",
    category: "action",
    possibleValues: [
      "website",
      "app",
      "messenger",
      "instagram_direct",
      "whatsapp",
      "facebook",
      "applinks_deeplink",
    ],
    blocksOffsiteMetrics: true,
  },
  {
    key: "action_target_id",
    name: "Action Target ID",
    description:
      "The ID of the target (page, app, etc.) where the action occurred.",
    category: "action",
    blocksOffsiteMetrics: true,
  },
  {
    key: "action_reaction",
    name: "Action Reaction",
    description:
      "For post reactions: like, love, wow, haha, sorry, anger, pride. Understand emotional response.",
    category: "action",
    possibleValues: ["like", "love", "wow", "haha", "sorry", "anger", "pride"],
  },
  {
    key: "action_video_sound",
    name: "Action Video Sound",
    description:
      "Whether sound was on or off during video views: on, off, unknown. Indicates engagement depth.",
    category: "action",
    possibleValues: ["on", "off", "unknown"],
  },
  {
    key: "action_video_type",
    name: "Action Video Type",
    description:
      "How the video was played: total, auto_play, click_to_play. Understand intentional vs passive viewing.",
    category: "action",
    possibleValues: ["total", "auto_play", "click_to_play"],
  },
  {
    key: "action_carousel_card_id",
    name: "Action Carousel Card ID",
    description:
      "Which carousel card drove the action. Optimize card order and content.",
    category: "action",
    blocksOffsiteMetrics: true,
  },
  {
    key: "action_carousel_card_name",
    name: "Action Carousel Card Name",
    description: "Name of the carousel card for easier identification.",
    category: "action",
    blocksOffsiteMetrics: true,
  },
  {
    key: "action_canvas_component_name",
    name: "Action Canvas Component Name",
    description:
      "Which component in your Instant Experience drove the action.",
    category: "action",
    blocksOffsiteMetrics: true,
  },
  {
    key: "conversion_destination",
    name: "Conversion Destination",
    description:
      "Where the conversion occurred: website, app, messaging, calls, on_facebook, on_instagram, offline.",
    category: "action",
    possibleValues: [
      "website",
      "app",
      "messaging",
      "calls",
      "on_facebook",
      "on_instagram",
      "offline",
    ],
  },
  {
    key: "standard_event_content_type",
    name: "Standard Event Content Type",
    description:
      "Type of content involved in standard events: product, product_group, flight, hotel, etc.",
    category: "action",
    possibleValues: ["product", "product_group", "flight", "hotel"],
  },
  {
    key: "signal_source_bucket",
    name: "Signal Source Bucket",
    description:
      "Source of conversion data: unmatched, browser_or_server, browser, server. Understand data quality.",
    category: "action",
    possibleValues: ["unmatched", "browser_or_server", "browser", "server"],
  },
  {
    key: "is_business_ai_assisted",
    name: "Business AI Assisted",
    description:
      "Whether the action was assisted by Meta's business AI features. true/false.",
    category: "action",
    possibleValues: ["true", "false"],
  },

  // ============================================
  // SKADNETWORK BREAKDOWNS (iOS)
  // ============================================
  {
    key: "skan_campaign_id",
    name: "SKAN Campaign ID",
    description:
      "Apple's SKAdNetwork campaign identifier for iOS 14.5+ attribution. Values 0-99.",
    category: "skan",
  },
  {
    key: "skan_conversion_id",
    name: "SKAN Conversion ID",
    description:
      "The conversion value (0-63) reported by SKAdNetwork. Represents conversion quality tiers.",
    category: "skan",
  },
  {
    key: "skan_version",
    name: "SKAN Version",
    description:
      "Which SKAdNetwork version reported the data (2.0, 3.0, 4.0). Affects available data.",
    category: "skan",
    possibleValues: ["2.0", "3.0", "4.0"],
  },
  {
    key: "coarse_conversion_value",
    name: "Coarse Conversion Value",
    description:
      "SKAN 4.0+ simplified values: low, medium, high. Broadest conversion quality indicator.",
    category: "skan",
    possibleValues: ["low", "medium", "high"],
  },
  {
    key: "postback_sequence_index",
    name: "Postback Sequence Index",
    description:
      "0, 1, or 2 indicating which postback window: 0 (day 0-2), 1 (day 3-7), 2 (day 8-35).",
    category: "skan",
    possibleValues: ["0", "1", "2"],
  },
  {
    key: "fidelity_type",
    name: "Fidelity Type",
    description:
      "SKAdNetwork fidelity indicator - confidence level of attribution.",
    category: "skan",
  },
  {
    key: "redownload",
    name: "Redownload",
    description:
      "Whether the install was a redownload (returning user) vs new install.",
    category: "skan",
    possibleValues: ["true", "false"],
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a breakdown definition by key
 */
export function getBreakdownByKey(key: string): BreakdownDefinition | undefined {
  return BREAKDOWN_CATALOG.find((b) => b.key === key);
}

/**
 * Get breakdowns by category
 */
export function getBreakdownsByCategory(
  category: BreakdownCategory
): BreakdownDefinition[] {
  return BREAKDOWN_CATALOG.filter((b) => b.category === category);
}

/**
 * Get standard breakdowns (not action breakdowns)
 */
export function getStandardBreakdowns(): BreakdownDefinition[] {
  return BREAKDOWN_CATALOG.filter(
    (b) => b.category !== "action" && b.category !== "skan"
  );
}

/**
 * Get action breakdowns only
 */
export function getActionBreakdowns(): BreakdownDefinition[] {
  return BREAKDOWN_CATALOG.filter((b) => b.category === "action");
}

/**
 * Get creative breakdowns (ad level only)
 */
export function getCreativeBreakdowns(): BreakdownDefinition[] {
  return BREAKDOWN_CATALOG.filter((b) => b.category === "creative");
}

/**
 * Check if breakdown is available at a specific level
 */
export function isBreakdownAvailableAtLevel(
  breakdownKey: string,
  level: "ad" | "adset" | "campaign" | "account"
): boolean {
  const breakdown = getBreakdownByKey(breakdownKey);
  if (!breakdown) return false;

  // If no level restrictions, available at all levels
  if (!breakdown.levelRestrictions) return true;

  // Check if the level is in the allowed list
  return breakdown.levelRestrictions.includes(level);
}

/**
 * Check if breakdown blocks offsite (conversion) metrics
 */
export function breakdownBlocksOffsiteMetrics(breakdownKey: string): boolean {
  const breakdown = getBreakdownByKey(breakdownKey);
  return breakdown?.blocksOffsiteMetrics === true;
}

/**
 * Get required combination breakdowns for a breakdown
 */
export function getRequiredCombinations(breakdownKey: string): string[] {
  const breakdown = getBreakdownByKey(breakdownKey);
  return breakdown?.requiresCombination || [];
}

/**
 * Get historical data limit in months for a breakdown
 */
export function getHistoricalLimit(breakdownKey: string): number | null {
  const breakdown = getBreakdownByKey(breakdownKey);
  return breakdown?.historicalLimit || null;
}

/**
 * Get all breakdown categories with their breakdowns
 */
export function getBreakdownsByCategories(): Record<
  BreakdownCategory,
  BreakdownDefinition[]
> {
  const categories: BreakdownCategory[] = [
    "demographic",
    "audience",
    "geographic",
    "platform",
    "creative",
    "product",
    "time",
    "action",
    "skan",
  ];

  return categories.reduce(
    (acc, category) => {
      acc[category] = getBreakdownsByCategory(category);
      return acc;
    },
    {} as Record<BreakdownCategory, BreakdownDefinition[]>
  );
}

/**
 * Validate breakdown combination
 * Returns list of errors if combination is invalid
 */
export function validateBreakdownCombination(
  breakdownKeys: string[],
  level: "ad" | "adset" | "campaign" | "account"
): string[] {
  const errors: string[] = [];

  for (const key of breakdownKeys) {
    const breakdown = getBreakdownByKey(key);

    if (!breakdown) {
      errors.push(`Unknown breakdown: ${key}`);
      continue;
    }

    // Check level restrictions
    if (!isBreakdownAvailableAtLevel(key, level)) {
      errors.push(
        `Breakdown "${breakdown.name}" is only available at ${breakdown.levelRestrictions?.join(", ")} level(s)`
      );
    }

    // Check required combinations
    const required = getRequiredCombinations(key);
    for (const reqKey of required) {
      if (!breakdownKeys.includes(reqKey)) {
        errors.push(
          `Breakdown "${breakdown.name}" requires "${reqKey}" to be included`
        );
      }
    }
  }

  // Check for mixing standard and action breakdowns inappropriately
  const hasStandard = breakdownKeys.some(
    (k) =>
      getBreakdownByKey(k)?.category !== "action" &&
      getBreakdownByKey(k)?.category !== "skan"
  );
  const hasAction = breakdownKeys.some(
    (k) => getBreakdownByKey(k)?.category === "action"
  );

  if (hasStandard && hasAction) {
    // Some combinations are allowed, but most aren't
    // This is a simplified check - the actual rules are more complex
    const standardKeys = breakdownKeys.filter(
      (k) =>
        getBreakdownByKey(k)?.category !== "action" &&
        getBreakdownByKey(k)?.category !== "skan"
    );
    const actionKeys = breakdownKeys.filter(
      (k) => getBreakdownByKey(k)?.category === "action"
    );

    // Only action_type can be combined with some standard breakdowns
    const nonActionTypeActions = actionKeys.filter((k) => k !== "action_type");
    if (nonActionTypeActions.length > 0 && standardKeys.length > 0) {
      errors.push(
        `Cannot combine ${nonActionTypeActions.join(", ")} with standard breakdowns`
      );
    }
  }

  return errors;
}

// ============================================
// ALLOWED BREAKDOWN COMBINATIONS
// ============================================

/**
 * Valid breakdown combinations as per Meta API documentation
 */
export const VALID_BREAKDOWN_COMBINATIONS: string[][] = [
  // Single breakdowns (always valid)
  ["age"],
  ["gender"],
  ["country"],
  ["region"],
  ["dma"],
  ["publisher_platform"],
  ["device_platform"],
  ["product_id"],
  ["hourly_stats_aggregated_by_advertiser_time_zone"],
  ["hourly_stats_aggregated_by_audience_time_zone"],
  ["frequency_value"],

  // Demographic combinations
  ["age", "gender"],

  // Platform/Device combinations
  ["action_device", "impression_device"],
  ["action_device", "publisher_platform"],
  ["action_device", "publisher_platform", "impression_device"],
  ["action_device", "publisher_platform", "platform_position"],
  ["action_device", "publisher_platform", "platform_position", "impression_device"],
  ["publisher_platform", "impression_device"],
  ["publisher_platform", "platform_position"],
  ["publisher_platform", "platform_position", "impression_device"],

  // Reaction combinations
  ["action_reaction"],
  ["action_type", "action_reaction"],

  // Carousel combinations
  ["action_carousel_card_id"],
  ["action_carousel_card_name"],
  ["action_carousel_card_id", "impression_device"],
  ["action_carousel_card_id", "country"],
  ["action_carousel_card_id", "age"],
  ["action_carousel_card_id", "gender"],
  ["action_carousel_card_id", "age", "gender"],
];

/**
 * Check if a breakdown combination is explicitly allowed
 */
export function isValidBreakdownCombination(breakdownKeys: string[]): boolean {
  // Single breakdown is always valid (if it exists)
  if (breakdownKeys.length === 1) {
    return getBreakdownByKey(breakdownKeys[0]) !== undefined;
  }

  // Check against valid combinations
  const sortedKeys = [...breakdownKeys].sort();

  return VALID_BREAKDOWN_COMBINATIONS.some((combo) => {
    const sortedCombo = [...combo].sort();
    if (sortedCombo.length !== sortedKeys.length) return false;
    return sortedCombo.every((key, index) => key === sortedKeys[index]);
  });
}
