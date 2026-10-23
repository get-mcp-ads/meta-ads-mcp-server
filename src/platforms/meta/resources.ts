/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { METRIC_CATALOG } from "./metric-catalog.js";
import { BREAKDOWN_CATALOG } from "./breakdown-catalog.js";
import { DIMENSION_CATALOG } from "./dimension-catalog.js";

const READ_ONLY_TOOLS = [
  "meta_get_adset_configuration",
  "meta_get_promotable_apps",
  "meta_get_catalog_batch_status",
  "meta_health_check",
  "meta_list_ad_accounts",
  "meta_get_account_details",
  "meta_get_business_assets",
  "meta_get_pages",
  "meta_get_instagram_accounts",
  "meta_get_pixels",
  "meta_get_campaigns",
  "meta_get_adsets",
  "meta_get_ads",
  "meta_get_ad_activity",
  "meta_get_delivery_diagnostics",
  "meta_get_creatives",
  "meta_get_creative_assets",
  "meta_get_insights",
  "meta_get_campaign_structure",
  "meta_get_audiences",
  "meta_get_audience_details",
  "meta_get_catalog_products",
  "meta_join_product_insights",
  "meta_get_brand_safety_controls",
  "meta_get_ad_studies",
  "meta_get_study_results",
  "meta_interpret_experiment_results",
  "meta_validate_query",
  "meta_get_page_posts",
  "meta_get_organic_content_enrichment",
  "meta_debug_token",
  "meta_search_entities",
  "meta_get_node_fields",
  "meta_list_edge_raw",
  "meta_get_insights_raw",
  "meta_search_targeting_options",
  "meta_get_ad_preview",
  "meta_list_ad_images",
  "meta_list_ad_videos",
  "meta_get_video_sources",
  "meta_get_entity_configuration",
  "meta_get_uploaded_video",
] as const;

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function registerMetaResources(server: McpServer, enableWrites = false): void {
  server.resource("meta-metrics", "meta://metrics", async () => ({
    contents: [
      {
        uri: "meta://metrics",
        mimeType: "application/json",
        text: JSON.stringify(
          METRIC_CATALOG.map((m) => ({
            key: m.key,
            name: m.name,
            description: m.description,
            category: m.category,
            type: m.type,
            format: m.format,
          })),
          null,
          2,
        ),
      },
    ],
  }));

  server.resource("meta-breakdowns", "meta://breakdowns", async () => ({
    contents: [
      {
        uri: "meta://breakdowns",
        mimeType: "application/json",
        text: JSON.stringify(
          BREAKDOWN_CATALOG.map((b) => ({
            key: b.key,
            name: b.name,
            description: b.description,
            category: b.category,
          })),
          null,
          2,
        ),
      },
    ],
  }));

  server.resource("meta-compatibility", "meta://compatibility", async () => {
    const compatMap: Record<string, string[]> = {};
    for (const m of METRIC_CATALOG) {
      compatMap[m.key] = m.compatibleBreakdowns;
    }
    return {
      contents: [
        {
          uri: "meta://compatibility",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description:
                "Metric-to-breakdown compatibility. Each metric key maps to an array of compatible breakdown keys.",
              metrics: compatMap,
              dimensions: typeof DIMENSION_CATALOG !== "undefined"
                ? DIMENSION_CATALOG.map((d: { key: string; name: string }) => ({
                    key: d.key,
                    name: d.name,
                  }))
                : [],
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.resource("meta-manifest", "meta://manifest", async () => jsonResource(
    "meta://manifest",
    {
      name: "Meta Ads MCP",
      platform: "meta",
      mode: "read-only",
      guarantees: [
        "Tools perform Graph API GET requests only.",
        "Access tokens are never returned in tool responses.",
        "Permission-sensitive edges return actionable warnings when possible.",
      ],
      required_scopes: ["ads_read"],
      recommended_scopes: [
        "business_management",
        "pages_show_list",
        "pages_read_engagement",
        "instagram_basic",
      ],
      optional_workflow_scopes: [
        {
          scope: "catalog_management",
          used_for: "GET-only Product Catalog/Product Item reads when Meta requires catalog-level permission.",
        },
      ],
      write_scopes_not_required: ["ads_management"],
      tools: READ_ONLY_TOOLS,
      resources: [
        "meta://metrics",
        "meta://breakdowns",
        "meta://compatibility",
        "meta://manifest",
        "meta://recipes",
        "meta://p2-readonly",
        "meta://app-review",
      ],
      first_tool_to_run: "meta_health_check",
    },
  ));

  server.resource("meta-recipes", "meta://recipes", async () => jsonResource(
    "meta://recipes",
    {
      recipes: [
        {
          name: "Health and permission triage",
          goal: "Confirm the token works and identify missing read-only scopes.",
          steps: [
            "Run meta_health_check.",
            "If ads_read is missing, refresh the token with ads_read.",
            "If business/page/IG discovery is incomplete, add only the recommended read-only scopes needed for that workflow.",
          ],
        },
        {
          name: "Business asset map",
          goal: "Build an inventory of Business Manager assets without write scopes.",
          steps: [
            "Run meta_get_business_assets with businessId when known.",
            "Fallback to adAccountId to discover account pixels and related business metadata.",
            "Use warnings to request exact missing asset permissions from the Business Manager admin.",
          ],
        },
        {
          name: "Delivery diagnostics",
          goal: "Find paused, rejected, or issue-bearing campaigns/ad sets/ads.",
          steps: [
            "Run meta_get_delivery_diagnostics with level=all and a recent date preset.",
            "Inspect effective_status, issues_info when present, and simple_insights together.",
            "Use level-specific pagination when the account is large.",
          ],
        },
        {
          name: "Creative asset audit",
          goal: "Normalize creative URLs, CTA, page, and Instagram references for analysis.",
          steps: [
            "Run meta_get_creative_assets with adAccountId for broad inventory.",
            "Pass adIds or creativeIds for targeted enrichment.",
            "Use thumbnail_url, image_url, video_id, link_url, call_to_action, object_story_spec, and asset_feed_spec.",
          ],
        },
        {
          name: "Audience inventory",
          goal: "Read custom, saved, and lookalike audiences with pagination.",
          steps: [
            "Run meta_get_audience_details with type=all for a first pass.",
            "Use type=custom, type=saved, or type=lookalike with returned cursors for precise pagination.",
            "Treat privacy-limited fields as expected Meta behavior and follow warnings.",
          ],
        },
        {
          name: "Catalog product enrichment",
          goal: "Join product-breakdown insights to catalog metadata when catalog access is available.",
          steps: [
            "Run meta_get_catalog_products with businessId to discover catalogId, or pass catalogId directly.",
            "Run meta_join_product_insights with productBreakdown=product_id and the selected catalogId.",
            "Use catalog_join.matched and warnings to separate missing catalog access from true unmatched product IDs.",
          ],
        },
        {
          name: "Brand safety/context controls read",
          goal: "Inspect placement and context-control settings without modifying block lists or ad sets.",
          steps: [
            "Run meta_get_brand_safety_controls with adAccountId.",
            "Review adset_context_controls for publisher platforms, positions, excluded publisher categories, and brand safety filter levels.",
            "Treat block-list warnings as expected when the Graph edge is not exposed for the account or rollout.",
          ],
        },
        {
          name: "Experiment/lift interpretation",
          goal: "Read studies and interpret confidence without overclaiming results.",
          steps: [
            "Run meta_interpret_experiment_results with studyId for a targeted read or adAccountId to discover studies.",
            "Use interpretation.confidence_read and guardrail fields before declaring a winner.",
            "Keep results below 90% confidence as directional or inconclusive.",
          ],
        },
        {
          name: "Organic Page/IG enrichment",
          goal: "Collect existing Page posts and Instagram media context for creative analysis.",
          steps: [
            "Run meta_get_organic_content_enrichment with pageId and includeInsights=false for the broadest compatibility.",
            "Set includeInsights=true only when Page/IG insight permissions are expected.",
            "Use warnings to distinguish missing permissions from unavailable media-type metrics.",
          ],
        },
        {
          name: "Change activity review",
          goal: "Review account activity history for debugging performance changes.",
          steps: [
            "Run meta_get_ad_activity with adAccountId, since, until, and limit.",
            "Correlate event_time and actor with performance changes from meta_get_insights.",
            "Increase date range only when needed to avoid noisy activity logs.",
          ],
        },
        {
          name: "Forward-compatible Graph exploration",
          goal: "Read new native fields and allowlisted edges before the curated MCP catalogs catch up.",
          steps: [
            "Use meta_get_node_fields for flat fields on a known Graph node.",
            "Use meta_list_edge_raw for allowlisted entity/asset edges with cursor pagination.",
            "Use meta_get_insights_raw only for native Insights fields not yet present in meta://metrics.",
            "Use meta_search_targeting_options for interest, locale, and geography dictionaries.",
          ],
        },
      ],
    },
  ));

  server.resource("meta-p2-readonly", "meta://p2-readonly", async () => jsonResource(
    "meta://p2-readonly",
    {
      positioning: "P2 tools extend read-only analysis coverage for catalog joins, brand safety/context controls, experiments/lift interpretation, and organic Page/IG enrichment.",
      guarantees: [
        "Every P2 tool performs Graph API GET requests only.",
        "P2 tools return warnings instead of failing hard when optional Graph edges are unavailable.",
        "P2 tools preserve access token redaction through the shared ok() response path.",
      ],
      tools: [
        {
          name: "meta_get_catalog_products",
          purpose: "Read product catalogs, product items, and optional product sets for join-ready metadata.",
          common_inputs: ["businessId", "catalogId", "productIds"],
          common_warning: "Catalog edges can require catalog asset access or catalog_management even for GET-only reads.",
        },
        {
          name: "meta_join_product_insights",
          purpose: "Query product-breakdown insights and enrich rows with catalog product groups.",
          common_inputs: ["adAccountId", "catalogId", "productBreakdown", "datePreset"],
          common_warning: "Product breakdown availability depends on objective, catalog setup, and metric compatibility.",
        },
        {
          name: "meta_get_brand_safety_controls",
          purpose: "Read ad set targeting context controls and optional publisher block-list metadata.",
          common_inputs: ["adAccountId", "businessId", "adsetIds"],
          common_warning: "Publisher block-list edges are rollout/version dependent and may only be visible in Business Manager UI.",
        },
        {
          name: "meta_interpret_experiment_results",
          purpose: "Read Ad Study cells/objectives and classify confidence with conservative lift-study guardrails.",
          common_inputs: ["studyId", "adAccountId", "includeCellEntities"],
          common_warning: "Full results payloads can be permission or whitelist dependent; basic objectives may still be available.",
        },
        {
          name: "meta_get_organic_content_enrichment",
          purpose: "Read Page posts and Instagram media with media URLs, permalinks, counts, attachments, and optional insights.",
          common_inputs: ["pageId", "instagramAccountId", "postIds", "mediaIds"],
          common_warning: "Organic insight metrics vary by Page/IG permission, media type, and Graph API version.",
        },
      ],
    },
  ));

  server.resource("meta-app-review", "meta://app-review", async () => jsonResource(
    "meta://app-review",
    {
      app_review_positioning: enableWrites
        ? "Write tools are enabled on this instance. It reads Meta Ads entities and can also update campaign, ad set and ad status, budgets, schedules and names, and create paused campaigns. Every write returns a preview and applies only when the caller repeats the call with confirm: true."
        : "This instance is read-only and does not create, update, pause, delete, or mutate Meta Ads entities. Write tools exist but are disabled unless META_ENABLE_WRITES is set.",
      writes_enabled: enableWrites,
      minimum_scope_for_ads_reporting: "ads_read",
      ...(enableWrites
        ? { scope_required_for_writes: "ads_management (required in addition to ads_read when writes are enabled)" }
        : {}),
      optional_read_only_scopes: [
        {
          scope: "business_management",
          reason: "Discover Business Manager assets such as businesses, pages, pixels, datasets, and partner/client assets when allowed.",
        },
        {
          scope: "pages_show_list",
          reason: "List Pages the token user can access for page and Instagram account discovery.",
        },
        {
          scope: "pages_read_engagement",
          reason: "Read Page metadata and posts for context; no publishing is performed.",
        },
        {
          scope: "instagram_basic",
          reason: "Read linked Instagram account profile metadata from Page or Business edges.",
        },
        {
          scope: "catalog_management",
          reason: "Optional for GET-only Product Catalog/Product Item reads when Meta requires catalog-level access. Catalog mutations require explicit write opt-in, the corresponding permission and confirmation.",
        },
      ],
      write_scopes_to_avoid_for_this_server: [
        ...(!enableWrites ? ["ads_management"] : []),
        "pages_manage_posts",
        "pages_manage_metadata",
        "instagram_content_publish",
      ],
      reviewer_test_flow: [
        "Configure META_ACCESS_TOKEN with ads_read.",
        "Run meta_health_check and verify the response contains token metadata, scopes, and ad account count without the access token.",
        "Run meta_list_ad_accounts and meta_get_insights for read-only reporting.",
        "Optionally grant business/page/IG read scopes and run meta_get_business_assets, meta_get_pages, meta_get_instagram_accounts, and meta_get_pixels.",
        "Optionally grant catalog access and run meta_get_catalog_products or meta_join_product_insights; verify only GET reads occur.",
        "Optionally run meta_get_brand_safety_controls, meta_interpret_experiment_results, and meta_get_organic_content_enrichment to verify P2 read-only workflows.",
      ],
      data_handling_notes: [
        "Tool responses redact access_token fields and access_token query parameters.",
        "Permission failures are returned as warnings for discovery tools when a partial response is still useful.",
        enableWrites ? "Write tools are enabled; each mutation requires confirm:true after preview." : "Write tools are disabled on this instance.",
      ],
    },
  ));
}
