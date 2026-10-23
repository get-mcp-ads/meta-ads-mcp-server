/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { reportingEvidence, measurementParams } from "./reporting-context.js";
import { z } from "zod";
import { getBusinessAssets } from "./business-assets.js";
import { instagramInsightMetrics } from "./organic-insights.js";
import { metaCreativeMedia, metaImageFileUrl } from "./creative-media.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaApiException, MetaClient } from "./client.js";
import { validateQuerySelection } from "./compatibility-rules.js";
import { planQueries, mergeResults } from "./query-planner.js";
import { calculateDerivedMetrics, calculateShareMetrics } from "./calculated-metrics.js";
import { insightDimensionKeys, enrichMetaDimensions } from "./report-dimensions.js";
import { formatMcpToolError } from "../../core/errors.js";
import type { MetaConfig } from "../../config/types.js";
import { registerMetaBroadReadTools } from "./broad-read.js";

// Shared schemas
const adAccountIdSchema = z.string().describe("Ad account ID (e.g., act_123456789)");
const levelSchema = z.enum(["account", "campaign", "adset", "ad"]);
const statusFilterSchema = z
  .enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"])
  .optional()
  .describe("Filter by native effective_status, not configured status. PAUSED excludes IN_PROCESS, CAMPAIGN_PAUSED and ADSET_PAUSED. Omit for post-creation verification and inspect both returned status fields.");
const limitSchema = z.number().int().min(1).max(500).optional().default(100);
const cursorSchema = z.string().optional().describe("Pagination cursor from previous response");
const productBreakdownSchema = z.enum([
  "product_id",
  "product_brand_breakdown",
  "product_category_breakdown",
  "product_type_breakdown",
  "product_custom_label_0_breakdown",
  "product_custom_label_1_breakdown",
  "product_custom_label_2_breakdown",
  "product_custom_label_3_breakdown",
  "product_custom_label_4_breakdown",
  "product_group_content_id_breakdown",
]);

const datePresetSchema = z
  .enum([
    "today", "yesterday", "this_month", "last_month", "this_quarter",
    "maximum", "data_maximum", "last_3d", "last_7d", "last_14d",
    "last_28d", "last_30d", "last_90d", "last_week_mon_sun",
    "last_week_sun_sat", "last_quarter", "last_year",
    "this_week_mon_today", "this_week_sun_today", "this_year",
  ])
  .optional();

const timeRangeSchema = z
  .object({
    since: z.string().describe("Start date YYYY-MM-DD"),
    until: z.string().describe("End date YYYY-MM-DD"),
  })
  .optional();

const META_GRAPH_BASE = "https://graph.facebook.com";
const REQUIRED_READ_SCOPES = ["ads_read"] as const;
const RECOMMENDED_READ_SCOPES = [
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;

type MetaWarning = {
  area: string;
  message: string;
  suggestion: string;
  code?: number;
  type?: string;
  subcode?: number;
  fbtraceId?: string;
};

let responseApiVersion: string | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnField(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function getDebugRecord(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload["debug"]) ? payload["debug"] : {};
}

function getRequestCount(payload: Record<string, unknown>): number {
  const debug = getDebugRecord(payload);
  const requestCount = debug["requestCount"];
  return typeof requestCount === "number" ? requestCount : 1;
}

function getWarnings(payload: Record<string, unknown>): unknown[] {
  if (Array.isArray(payload["warnings"])) return payload["warnings"];

  const debug = getDebugRecord(payload);
  return Array.isArray(debug["warnings"]) ? debug["warnings"] : [];
}

function withAgentResponseContract(data: unknown): unknown {
  if (!isRecord(data)) return data;

  return {
    ...data,
    warnings: hasOwnField(data, "warnings") ? data["warnings"] : getWarnings(data),
    limitations: hasOwnField(data, "limitations") ? data["limitations"] : [],
    nextActions: hasOwnField(data, "nextActions") ? data["nextActions"] : [],
    debug: {
      ...getDebugRecord(data),
      source: "meta_ads",
      apiVersion: responseApiVersion,
      requestCount: getRequestCount(data),
    },
  };
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "access_token" ||
        lowerKey === "input_token" ||
        lowerKey === "appsecret_proof" ||
        lowerKey === "client_secret" ||
        lowerKey.endsWith("_access_token")
      ) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactSensitive(item);
      }
    }
    return redacted;
  }

  if (typeof value === "string" && value.includes("access_token=")) {
    try {
      const url = new URL(value);
      if (url.searchParams.has("access_token")) {
        url.searchParams.set("access_token", "[REDACTED]");
      }
      return url.toString();
    } catch {
      return value.replace(/access_token=([^&\s]+)/g, "access_token=[REDACTED]");
    }
  }

  return value;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(redactSensitive(withAgentResponseContract(data)), null, 2) }] };
}

function formatAdAccountId(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

function graphUrl(
  client: MetaClient,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const base = normalizedPath
    ? `${META_GRAPH_BASE}/${client.apiVersion}/${normalizedPath}`
    : `${META_GRAPH_BASE}/${client.apiVersion}/`;
  const url = new URL(base);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function warningFromError(area: string, error: unknown, suggestion: string): MetaWarning {
  if (error instanceof MetaApiException) {
    return {
      area,
      message: error.message,
      suggestion,
      code: error.code,
      type: error.type,
      subcode: error.subcode,
      fbtraceId: error.fbtraceId,
    };
  }

  return {
    area,
    message: error instanceof Error ? error.message : String(error),
    suggestion,
  };
}

async function fetchGraph(
  client: MetaClient,
  area: string,
  url: string,
  warnings: MetaWarning[],
  suggestion: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await client.fetchUrl(url);
  } catch (error) {
    warnings.push(warningFromError(area, error, suggestion));
    return null;
  }
}

async function fetchGraphWithFallback(
  client: MetaClient,
  area: string,
  primaryUrl: string,
  fallbackUrl: string,
  warnings: MetaWarning[],
  suggestion: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await client.fetchUrl(primaryUrl);
  } catch (primaryError) {
    try {
      const fallback = await client.fetchUrl(fallbackUrl);
      warnings.push({
        ...warningFromError(area, primaryError, suggestion),
        suggestion: `${suggestion} Returned a minimal read-only field set instead.`,
      });
      return fallback;
    } catch (fallbackError) {
      warnings.push(warningFromError(area, fallbackError, suggestion));
      return null;
    }
  }
}

function pageClientResolver(client: MetaClient, warnings: MetaWarning[]) {
  const pageClients = new Map<string, MetaClient | null>();
  const pageClientFor = async (id: string): Promise<MetaClient | null> => {
    if (!pageClients.has(id)) {
      const result = await fetchGraph(client, "organic_page_token", graphUrl(client, `/${encodeURIComponent(id)}`, {fields: "access_token"}), warnings,
        "Grant pages_show_list/pages_read_engagement and access to this Page, then reconnect Meta if necessary.");
      const token = typeof result?.access_token === "string" ? result.access_token : undefined;
      pageClients.set(id, token ? new MetaClient(token, client.apiVersion) : null);
      if (result && !token) warnings.push({area: "organic_page_token", message: "Meta did not return a Page access token.", suggestion: "Verify this user's Page tasks and reconnect Meta. No user token is substituted for a Page token."});
    }
    return pageClients.get(id) ?? null;
  };
  return pageClientFor;
}

function dataArray(result: Record<string, unknown> | null): Record<string, unknown>[] {
  const data = result?.data;
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

function entityListResult(result: Record<string, unknown>, statusFilter?: string) {
  return {
    ...result,
    coverage: {
      scope: "returned_page",
      returned_count: dataArray(result).length,
      has_more: !!(isRecord(result.paging) && result.paging.next),
      status_filter_field: statusFilter ? "effective_status" : null,
      status_filter: statusFilter ?? null,
    },
    notes: [
      "Follow paging.cursors.after while paging.next is present. A limited or filtered listing does not prove that an object does not exist.",
      "status is configured status; effective_status can differ during processing or due to a paused parent. Omit statusFilter when verifying a newly created object.",
      "An empty listing alone does not establish indexing lag or its cause. Read known campaign IDs with meta_get_campaign_structure.",
    ],
  };
}

function pagingInfo(result: Record<string, unknown> | null): unknown {
  return isRecord(result?.paging) ? result.paging : undefined;
}

function pictureUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;

  const data = value.data;
  if (isRecord(data) && typeof data.url === "string") {
    return data.url;
  }

  return undefined;
}

function thumbnailSummary(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value || typeof value.uri !== "string") return undefined;
  return { uri: value.uri, width: value.width, height: value.height };
}

function normalizeAdVideo(video: Record<string, unknown>, includeSource: boolean): Record<string, unknown> {
  const status = isRecord(video.status) ? video.status : undefined;
  const thumbnailEdge = isRecord(video.thumbnails) ? video.thumbnails.data : undefined;
  const thumbnails = Array.isArray(thumbnailEdge) ? thumbnailEdge.filter(isRecord) : [];
  const preferred = thumbnails.find((thumb) => thumb.is_preferred === true) ?? thumbnails[0];
  let largest: Record<string, unknown> | undefined;
  for (const thumb of thumbnails) {
    if (!largest || (Number(thumb.width) || 0) > (Number(largest.width) || 0)) largest = thumb;
  }

  const from = isRecord(video.from) ? video.from : undefined;

  return {
    id: video.id,
    title: video.title,
    video_status: typeof status?.video_status === "string" ? status.video_status : undefined,
    duration_seconds: typeof video.length === "number" ? video.length : undefined,
    owner: from ? { id: from.id, name: from.name } : undefined,
    created_time: video.created_time,
    updated_time: video.updated_time,
    picture: video.picture,
    permalink_url: video.permalink_url,
    thumbnail_preferred: thumbnailSummary(preferred),
    thumbnail_largest: thumbnailSummary(largest),
    thumbnail_count: thumbnails.length,
    ...(includeSource ? { source: video.source } : {}),
  };
}

function addById(
  target: Map<string, Record<string, unknown>>,
  items: Record<string, unknown>[],
): void {
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id : undefined;
    if (!id) continue;
    target.set(id, { ...(target.get(id) ?? {}), ...item });
  }
}

function normalizePage(page: Record<string, unknown>, source: string): Record<string, unknown> {
  return {
    id: page.id,
    name: page.name,
    category: page.category,
    tasks: page.tasks,
    picture: pictureUrl(page.picture),
    instagram_business_account: page.instagram_business_account,
    connected_instagram_account: page.connected_instagram_account,
    source,
  };
}

function normalizeInstagramAccount(
  account: Record<string, unknown>,
  source: string,
  context: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    ig_id: account.ig_id,
    profile_picture_url: account.profile_picture_url ?? pictureUrl(account.profile_picture),
    source,
    ...context,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function extractCreativeCallToAction(creative: Record<string, unknown>): unknown {
  if (creative.call_to_action_type) return creative.call_to_action_type;

  const spec = creative.object_story_spec;
  if (!isRecord(spec)) return undefined;

  for (const key of ["link_data", "video_data", "template_data"] as const) {
    const value = spec[key];
    if (isRecord(value) && value.call_to_action) {
      return value.call_to_action;
    }
  }

  return undefined;
}

function extractCreativeLinkUrl(creative: Record<string, unknown>): string | undefined {
  const spec = creative.object_story_spec;
  const assetFeed = creative.asset_feed_spec;
  const assetFeedRecord = isRecord(assetFeed) ? assetFeed : undefined;
  const linkData = isRecord(spec) && isRecord(spec.link_data) ? spec.link_data : undefined;
  const videoData = isRecord(spec) && isRecord(spec.video_data) ? spec.video_data : undefined;
  const templateData = isRecord(spec) && isRecord(spec.template_data) ? spec.template_data : undefined;
  const videoCta = isRecord(videoData?.call_to_action) ? videoData.call_to_action : undefined;
  const videoCtaValue = isRecord(videoCta?.value) ? videoCta.value : undefined;
  const linkUrls = assetFeedRecord && Array.isArray(assetFeedRecord.link_urls)
    ? assetFeedRecord.link_urls.filter(isRecord)
    : [];
  const firstAssetLink = linkUrls[0];

  return firstString(
    creative.link_url,
    linkData?.link,
    linkData?.template_url,
    templateData?.link,
    templateData?.template_url,
    templateData?.website_url,
    videoCtaValue?.link,
    assetFeedRecord?.template_url,
    firstAssetLink?.website_url,
    firstAssetLink?.url,
  );
}

function normalizeCreativeAsset(
  source: Record<string, unknown>,
  sourceType: "ad" | "creative",
): Record<string, unknown> {
  const creative = sourceType === "ad" && isRecord(source.creative)
    ? source.creative
    : source;
  const spec = isRecord(creative.object_story_spec) ? creative.object_story_spec : {};
  const linkData = isRecord(spec.link_data) ? spec.link_data : undefined;
  const videoData = isRecord(spec.video_data) ? spec.video_data : undefined;
  const photoData = isRecord(spec.photo_data) ? spec.photo_data : undefined;
  const templateData = isRecord(spec.template_data) ? spec.template_data : undefined;

  return {
    ...(() => { const media = metaCreativeMedia(creative); return { creative_format: media.format, media: media.media }; })(),
    source_type: sourceType,
    ad_id: sourceType === "ad" ? source.id : undefined,
    ad_name: sourceType === "ad" ? source.name : undefined,
    ad_status: sourceType === "ad" ? source.status : undefined,
    ad_effective_status: sourceType === "ad" ? source.effective_status : undefined,
    creative_id: creative.id,
    creative_name: creative.name,
    thumbnail_url: creative.thumbnail_url,
    image_url: firstString(
      creative.image_url,
      linkData?.image_url,
      videoData?.image_url,
      photoData?.url,
    ),
    video_id: firstString(creative.video_id, videoData?.video_id),
    link_url: extractCreativeLinkUrl(creative),
    product_set_id: firstString(
      creative.product_set_id,
      linkData?.product_set_id,
      templateData?.product_set_id,
      isRecord(creative.asset_feed_spec) ? creative.asset_feed_spec.product_set_id : undefined,
    ),
    call_to_action: extractCreativeCallToAction(creative),
    page_id: spec.page_id,
    instagram_actor_id: spec.instagram_actor_id,
    effective_object_story_id: creative.effective_object_story_id,
    object_type: creative.object_type,
    object_story_spec: creative.object_story_spec,
    asset_feed_spec: creative.asset_feed_spec,
    raw_creative: creative,
  };
}

function entityIssueSummary(entity: Record<string, unknown>): Record<string, unknown> {
  const effectiveStatus = entity.effective_status;
  const issues = entity.issues_info;
  const learning = entity.learning_stage_info;
  const hasIssues = Array.isArray(issues) ? issues.length > 0 : Boolean(issues);

  return {
    ...entity,
    delivery_summary: {
      configured_status: entity.configured_status ?? entity.status,
      effective_status: effectiveStatus,
      has_issues: hasIssues,
      issues_info: issues,
      learning_stage_info: learning,
    },
  };
}

function summaryCount(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.summary)) return undefined;
  const total = value.summary.total_count;
  return typeof total === "number" ? total : undefined;
}

function normalizeProductItem(
  product: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  const catalog = isRecord(product.product_catalog) ? product.product_catalog : undefined;
  const group = isRecord(product.product_group) ? product.product_group : undefined;

  return {
    id: product.id,
    retailer_id: product.retailer_id,
    name: product.name,
    description: product.description,
    brand: product.brand,
    category: product.category ?? product.fb_product_category,
    product_type: product.product_type,
    price: product.price,
    sale_price: product.sale_price,
    currency: product.currency,
    availability: product.availability,
    inventory: product.inventory,
    visibility: product.visibility,
    review_status: product.review_status,
    url: product.url,
    image_url: product.image_url,
    additional_image_urls: product.additional_image_urls,
    custom_label_0: product.custom_label_0,
    custom_label_1: product.custom_label_1,
    custom_label_2: product.custom_label_2,
    custom_label_3: product.custom_label_3,
    custom_label_4: product.custom_label_4,
    product_catalog_id: catalog?.id,
    product_catalog_name: catalog?.name,
    product_group_id: group?.id,
    retailer_product_group_id: product.retailer_product_group_id,
    source,
    raw_product: product,
  };
}

function stringValues(...values: unknown[]): string[] {
  return values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return [value];
    })
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function productKeysForBreakdown(
  product: Record<string, unknown>,
  breakdown: z.infer<typeof productBreakdownSchema>,
): string[] {
  const raw = isRecord(product.raw_product) ? product.raw_product : product;
  const productGroup = isRecord(raw.product_group) ? raw.product_group : undefined;

  switch (breakdown) {
    case "product_brand_breakdown":
      return stringValues(product.brand, raw.brand);
    case "product_category_breakdown":
      return stringValues(product.category, raw.category, raw.fb_product_category);
    case "product_type_breakdown":
      return stringValues(product.product_type, raw.product_type);
    case "product_custom_label_0_breakdown":
      return stringValues(product.custom_label_0, raw.custom_label_0);
    case "product_custom_label_1_breakdown":
      return stringValues(product.custom_label_1, raw.custom_label_1);
    case "product_custom_label_2_breakdown":
      return stringValues(product.custom_label_2, raw.custom_label_2);
    case "product_custom_label_3_breakdown":
      return stringValues(product.custom_label_3, raw.custom_label_3);
    case "product_custom_label_4_breakdown":
      return stringValues(product.custom_label_4, raw.custom_label_4);
    case "product_group_content_id_breakdown":
      return stringValues(
        product.retailer_product_group_id,
        raw.retailer_product_group_id,
        product.product_group_id,
        productGroup?.id,
      );
    case "product_id":
    default:
      return stringValues(product.id, product.retailer_id, raw.id, raw.retailer_id);
  }
}

function buildProductLookup(
  products: Record<string, unknown>[],
  breakdown: z.infer<typeof productBreakdownSchema>,
): Map<string, Record<string, unknown>[]> {
  const lookup = new Map<string, Record<string, unknown>[]>();

  for (const product of products) {
    for (const key of productKeysForBreakdown(product, breakdown)) {
      const existing = lookup.get(key) ?? [];
      existing.push(product);
      lookup.set(key, existing);
    }
  }

  return lookup;
}

function summarizeProductGroup(
  key: string,
  products: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    key,
    product_count: products.length,
    sample_products: products.slice(0, 5),
  };
}

function productSearchMatches(product: Record<string, unknown>, search: string | undefined): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [
    product.id,
    product.retailer_id,
    product.name,
    product.brand,
    product.category,
    product.product_type,
    product.custom_label_0,
    product.custom_label_1,
    product.custom_label_2,
    product.custom_label_3,
    product.custom_label_4,
  ].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

function normalizeMetricKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function findNumberDeep(value: unknown, candidateKeys: string[]): number | undefined {
  const normalizedCandidates = new Set(candidateKeys.map(normalizeMetricKey));
  const seen = new Set<unknown>();

  const visit = (current: unknown): number | undefined => {
    if (current === null || current === undefined || seen.has(current)) return undefined;
    if (typeof current !== "object") return undefined;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }

    if (!isRecord(current)) return undefined;

    for (const [key, item] of Object.entries(current)) {
      if (normalizedCandidates.has(normalizeMetricKey(key))) {
        const valueNumber = numberFromUnknown(item);
        if (valueNumber !== undefined) return valueNumber;
      }
    }

    for (const item of Object.values(current)) {
      const found = visit(item);
      if (found !== undefined) return found;
    }

    return undefined;
  };

  return visit(value);
}

function interpretConfidence(confidence: number | undefined): Record<string, unknown> {
  if (confidence === undefined) {
    return {
      band: "unknown",
      actionability: "manual_review",
      message: "No confidence metric was exposed by the Graph API response.",
    };
  }

  if (confidence >= 95) {
    return {
      band: "statistically_significant",
      actionability: "act_with_confidence",
      message: "Confidence is at or above 95%.",
    };
  }

  if (confidence >= 90) {
    return {
      band: "likely_significant",
      actionability: "act_carefully_or_retest",
      message: "Confidence is between 90% and 95%.",
    };
  }

  if (confidence >= 80) {
    return {
      band: "directional",
      actionability: "extend_or_increase_power",
      message: "Confidence is directional but below a normal decision threshold.",
    };
  }

  return {
    band: "inconclusive",
    actionability: "do_not_declare_winner",
    message: "Confidence is below 80%. Treat the result as inconclusive.",
  };
}

function interpretStudyObjective(objective: Record<string, unknown>): Record<string, unknown> {
  const confidence = findNumberDeep(objective, [
    "confidence",
    "confidence_level",
    "confidenceLevel",
    "statistical_confidence",
  ]);
  const lift = findNumberDeep(objective, [
    "lift",
    "lift_percentage",
    "incremental_lift",
    "conversion_lift",
    "incremental_conversion_lift",
  ]);
  const incrementalConversions = findNumberDeep(objective, [
    "incremental_conversions",
    "incremental_conversion",
    "conversions_incremental",
  ]);
  const costPerIncrementalConversion = findNumberDeep(objective, [
    "cost_per_incremental_conversion",
    "cpi_conversion",
    "cost_per_incremental_action",
  ]);
  const incrementalValue = findNumberDeep(objective, [
    "incremental_value",
    "incremental_revenue",
    "incremental_purchase_value",
  ]);
  const spend = findNumberDeep(objective, ["spend", "amount_spent"]);
  const incrementalRoas = incrementalValue !== undefined && spend !== undefined && spend > 0
    ? incrementalValue / spend
    : findNumberDeep(objective, ["incremental_roas", "i_roas", "iroas"]);

  return {
    ...objective,
    interpretation: {
      confidence,
      lift_percentage: lift,
      incremental_conversions: incrementalConversions,
      cost_per_incremental_conversion: costPerIncrementalConversion,
      incremental_value: incrementalValue,
      incremental_roas: incrementalRoas,
      confidence_read: interpretConfidence(confidence),
      guardrail:
        "Do not declare a winner below 90% confidence; use inconclusive or directional language and consider extending or redesigning the test.",
    },
  };
}

function inferStudyStatus(study: Record<string, unknown>): string {
  if (typeof study.canceled_time === "string") return "canceled";
  const now = Date.now();
  const start = typeof study.start_time === "string" ? Date.parse(study.start_time) : undefined;
  const end = typeof study.end_time === "string" ? Date.parse(study.end_time) : undefined;
  if (start !== undefined && Number.isFinite(start) && start > now) return "scheduled";
  if (end !== undefined && Number.isFinite(end) && end < now) return "completed";
  if (start !== undefined && Number.isFinite(start) && start <= now) return "running";
  return "unknown";
}

function summarizeBrandSafetyTargeting(adset: Record<string, unknown>): Record<string, unknown> {
  const targeting = isRecord(adset.targeting) ? adset.targeting : {};
  return {
    id: adset.id,
    name: adset.name,
    campaign_id: adset.campaign_id,
    status: adset.status,
    effective_status: adset.effective_status,
    controls: {
      publisher_platforms: targeting.publisher_platforms,
      facebook_positions: targeting.facebook_positions,
      instagram_positions: targeting.instagram_positions,
      audience_network_positions: targeting.audience_network_positions,
      messenger_positions: targeting.messenger_positions,
      device_platforms: targeting.device_platforms,
      excluded_publisher_categories: targeting.excluded_publisher_categories,
      brand_safety_content_filter_levels: targeting.brand_safety_content_filter_levels,
      excluded_brand_safety_content_types: targeting.excluded_brand_safety_content_types,
    },
  };
}

function normalizeOrganicPost(post: Record<string, unknown>): Record<string, unknown> {
  return {
    id: post.id,
    message: post.message,
    created_time: post.created_time,
    type: post.type,
    permalink_url: post.permalink_url,
    full_picture: post.full_picture,
    attachments: post.attachments,
    counts: {
      shares: isRecord(post.shares) ? post.shares.count : undefined,
      likes: summaryCount(post.likes),
      comments: summaryCount(post.comments),
    },
    insights: post.insights,
    raw_post: post,
  };
}

function normalizeInstagramMedia(media: Record<string, unknown>): Record<string, unknown> {
  return {
    id: media.id,
    caption: media.caption,
    media_type: media.media_type,
    media_product_type: media.media_product_type,
    media_url: media.media_url,
    thumbnail_url: media.thumbnail_url,
    permalink: media.permalink,
    timestamp: media.timestamp,
    username: media.username,
    like_count: media.like_count,
    comments_count: media.comments_count,
    children: media.children,
    insights: media.insights,
    raw_media: media,
  };
}

export function registerMetaTools(server: McpServer, config: MetaConfig): void {
  const client = new MetaClient(config.accessToken, config.apiVersion);
  responseApiVersion = client.apiVersion;

  // ── P0/P1. meta_health_check ──────────────────────────────────────
  server.tool(
    "meta_health_check",
    "Read-only connection diagnostic: inspects token identity and granted permissions, and lists accessible ad accounts without exposing the access token. Unavailable checks remain unknown; granted scopes do not prove app access level or clearance of Meta security checkpoints.",
    {},
    async () => {
      const warnings: MetaWarning[] = [];
      let tokenValid: boolean | null = null;
      let grantedScopes: string[] | null = null;
      let permissionSource: "debug_token" | "me_permissions" | null = null;
      let tokenCheck: Record<string, unknown> = { ok: false, is_valid: null, status: "unavailable" };
      let permissionsCheck: Record<string, unknown> = { ok: false, status: "unavailable", scopes: null };
      let identityCheck: Record<string, unknown> = { ok: false, user_id: null, app_id: null };
      let adAccountCheck: Record<string, unknown> = { ok: false };

      try {
        const tokenInfo = await client.debugToken();
        tokenValid = tokenInfo.is_valid;
        identityCheck = { ok: Boolean(tokenInfo.user_id), source: "debug_token", user_id: tokenInfo.user_id ?? null, app_id: tokenInfo.app_id ?? null };
        if (Array.isArray(tokenInfo.scopes)) {
          grantedScopes = tokenInfo.scopes;
          permissionSource = "debug_token";
        }

        if (!tokenInfo.is_valid) {
          warnings.push({
            area: "token",
            message: "Meta reports the access token as invalid.",
            suggestion: "Refresh the token and run meta_health_check again.",
          });
        }

        tokenCheck = {
          ok: true,
          status: tokenInfo.is_valid ? "valid" : "invalid",
          is_valid: tokenInfo.is_valid,
          app_id: tokenInfo.app_id,
          user_id: tokenInfo.user_id,
          type: tokenInfo.type,
          expires_at: tokenInfo.expires_at,
          data_access_expires_at: tokenInfo.data_access_expires_at,
          expires_at_iso: tokenInfo.expires_at
            ? new Date(tokenInfo.expires_at * 1000).toISOString()
            : null,
          scopes: grantedScopes,
        };
      } catch (error) {
        warnings.push(warningFromError(
          "token",
          error,
          "Meta inspects a token with itself only when its user develops or administers the app; System User tokens qualify. This failure alone does not establish token expiry or missing permissions.",
        ));
      }

      if (grantedScopes === null && tokenValid !== false) {
        try {
          grantedScopes = await client.getGrantedPermissions();
          permissionSource = "me_permissions";
        } catch (error) {
          warnings.push(warningFromError("scopes", error,
            "Granted permissions could not be verified. Do not treat an unavailable diagnostic as a missing grant."));
        }
      }
      if (tokenValid === null) {
        try {
          const identity = await client.getCurrentUserIdentity();
          identityCheck = { ok: true, source: "me", user_id: identity.id, name: identity.name, app_id: null };
        } catch (error) {
          warnings.push(warningFromError("identity", error,
            "The connecting user could not be independently identified; app and token metadata remain unverified."));
        }
      }
      const missingRequired = grantedScopes === null ? null : REQUIRED_READ_SCOPES.filter(scope => !grantedScopes.includes(scope));
      const missingRecommended = grantedScopes === null ? null : RECOMMENDED_READ_SCOPES.filter(scope => !grantedScopes.includes(scope));
      if (grantedScopes !== null) {
        permissionsCheck = {
          ok: true, status: "verified", source: permissionSource, scopes: grantedScopes,
          missing_required_scopes: missingRequired, missing_recommended_scopes: missingRecommended,
        };
      }
      if (missingRequired?.length) {
        warnings.push({ area: "scopes", message: `Missing required read scope(s): ${missingRequired.join(", ")}.`,
          suggestion: "Grant ads_read for ad account reporting." });
      }
      if (missingRecommended?.length) {
        warnings.push({ area: "scopes", message: `Missing recommended discovery scope(s): ${missingRecommended.join(", ")}.`,
          suggestion: "Grant the relevant permissions when you need business, page, Instagram, or pixel discovery." });
      }

      try {
        const accounts = await client.getAdAccounts();
        const inactiveAccounts = accounts.filter((account) => {
          const status = isRecord(account) ? account["account_status"] : undefined;
          return status !== undefined && String(status) !== "1";
        });
        adAccountCheck = {
          ok: true,
          count: accounts.length,
          accounts,
        };
        if (inactiveAccounts.length > 0) {
          warnings.push({
            area: "ad_accounts",
            message: `${inactiveAccounts.length} accessible ad account(s) are not ACTIVE (account_status != 1).`,
            suggestion: "Exclude disabled or non-active ad accounts from automatic account mapping unless the user explicitly selects them.",
          });
        }
      } catch (error) {
        warnings.push(warningFromError(
          "ad_accounts",
          error,
          "Grant ads_read and confirm the user has access to at least one Meta ad account.",
        ));
      }

      const insightsOk = tokenValid !== false && missingRequired?.length === 0 && adAccountCheck.ok === true;
      const discoveryOk = tokenValid !== false && missingRecommended?.length === 0;
      const adsManagementGranted = grantedScopes === null ? null : grantedScopes.includes("ads_management");
      const pagesManageAdsGranted = grantedScopes === null ? null : grantedScopes.includes("pages_manage_ads");

      return ok({
        status: tokenValid === false ? "error" : tokenValid === null || !insightsOk ? "degraded" : "ok",
        apiVersion: client.apiVersion,
        capabilities: {
          insights: {
            status: missingRequired === null ? "unknown" : insightsOk ? "ok" : "degraded",
            requiredScopes: [...REQUIRED_READ_SCOPES],
            missingRequiredScopes: missingRequired,
          },
          discovery: {
            status: missingRecommended === null ? "unknown" : discoveryOk ? "ok" : "degraded",
            recommendedScopes: [...RECOMMENDED_READ_SCOPES],
            missingRecommendedScopes: missingRecommended,
          },
          writeSurface: {
            status: adsManagementGranted === null ? "unknown" : adsManagementGranted && tokenValid !== false ? "ok" : "degraded",
            writesEnabled: config.enableWrites === true,
            adsManagementGranted,
            pagesManageAdsGranted,
            permissionSource,
            appAccessLevel: "not_checked",
            accountSecurityCheckpoint: "not_checked",
            note: adsManagementGranted === null
              ? "Write permissions are unknown because permission inspection was unavailable."
              : "Verified scopes do not establish app access level, Page/account asset assignments, or clearance of Meta security checkpoints. Writes also require META_ENABLE_WRITES and a confirmed call.",
          },
        },
        checks: {
          token: tokenCheck,
          identity: identityCheck,
          permissions: permissionsCheck,
          ad_accounts: adAccountCheck,
        },
        warnings,
      });
    },
  );

  // ── P0/P1. meta_get_business_assets ───────────────────────────────
  server.tool(
    "meta_get_business_assets",
    "Discover accessible Meta Business assets read-only: businesses, pages, Instagram accounts, pixels, and datasets when permissions allow.",
    {
      businessId: z.string().optional().describe("Business Manager ID. With adAccountId, discover only its owning Business; otherwise list /me/businesses when this is omitted."),
      adAccountId: adAccountIdSchema.optional().describe("Optional ad account ID to discover its owner Business and assigned pixels; datasets are read from that Business when permitted."),
      limit: limitSchema,
      cursor: cursorSchema.describe("Legacy cursor for /me/businesses only. Use cursors for asset edges."),
      cursors: z.record(z.string(), z.string()).optional().describe("Per-edge cursors from paging/nextActions. Never reuse a cursor for another edge."),
      maxPages: z.number().int().min(1).max(5).default(3).describe("Maximum pages per edge; remaining pages are reported explicitly."),
    },
    async (args) => { try { return ok(await getBusinessAssets(client, args)); } catch(e) { return formatMcpToolError(e); } },
  );

  // ── P0/P1. meta_get_pages ─────────────────────────────────────────
  server.tool(
    "meta_get_pages",
    "List accessible Facebook Pages with id, name, category, tasks, picture, and linked Instagram account references when available.",
    {
      businessId: z.string().optional().describe("Optional Business Manager ID to list owned/client pages. Omit to use /me/accounts."),
      limit: z.number().int().min(1).max(200).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ businessId, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const pagesById = new Map<string, Record<string, unknown>>();
      const fields = "id,name,category,tasks,picture{url},instagram_business_account{id,username,name,ig_id,profile_picture_url},connected_instagram_account{id,username,name,ig_id,profile_picture_url}";
      const fallbackFields = "id,name,category,tasks,picture{url}";
      const paging: Record<string, unknown> = {};

      if (businessId) {
        const ownedPages = await fetchGraphWithFallback(
          client,
          "owned_pages",
          graphUrl(client, `/${businessId}/owned_pages`, { fields, limit, after: cursor }),
          graphUrl(client, `/${businessId}/owned_pages`, { fields: fallbackFields, limit, after: cursor }),
          warnings,
          "Grant business_management plus pages_show_list/pages_read_engagement to read Business-owned Pages.",
        );
        const clientPages = await fetchGraphWithFallback(
          client,
          "client_pages",
          graphUrl(client, `/${businessId}/client_pages`, { fields, limit, after: cursor }),
          graphUrl(client, `/${businessId}/client_pages`, { fields: fallbackFields, limit, after: cursor }),
          warnings,
          "Client Page access may require Business Manager partner permissions.",
        );

        addById(pagesById, dataArray(ownedPages).map((page) => normalizePage(page, "owned_pages")));
        addById(pagesById, dataArray(clientPages).map((page) => normalizePage(page, "client_pages")));
        paging.owned_pages = pagingInfo(ownedPages);
        paging.client_pages = pagingInfo(clientPages);
      } else {
        const pages = await fetchGraphWithFallback(
          client,
          "me_accounts",
          graphUrl(client, "/me/accounts", { fields, limit, after: cursor }),
          graphUrl(client, "/me/accounts", { fields: fallbackFields, limit, after: cursor }),
          warnings,
          "Grant pages_show_list and pages_read_engagement to list Pages managed by the user.",
        );
        addById(pagesById, dataArray(pages).map((page) => normalizePage(page, "me/accounts")));
        paging.me_accounts = pagingInfo(pages);
      }

      return ok({
        pages: [...pagesById.values()],
        count: pagesById.size,
        paging,
        warnings,
      });
    },
  );

  // ── P0/P1. meta_get_instagram_accounts ────────────────────────────
  server.tool(
    "meta_get_instagram_accounts",
    "List Instagram accounts linked to accessible Pages, Business Manager assets, or an ad account when permissions allow.",
    {
      adAccountId: adAccountIdSchema.optional().describe("Optional ad account ID for /instagram_accounts."),
      businessId: z.string().optional().describe("Optional Business Manager ID for owned/client Instagram account edges."),
      pageId: z.string().optional().describe("Optional Page ID to read linked instagram_business_account/connected_instagram_account."),
      limit: z.number().int().min(1).max(200).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ adAccountId, businessId, pageId, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const accountsById = new Map<string, Record<string, unknown>>();
      const fields = "id,username,name,ig_id,profile_picture_url";
      const pageFields = "id,name,instagram_business_account{id,username,name,ig_id,profile_picture_url},connected_instagram_account{id,username,name,ig_id,profile_picture_url}";
      const paging: Record<string, unknown> = {};

      if (pageId) {
        const page = await fetchGraph(
          client,
          "page_instagram_accounts",
          graphUrl(client, `/${pageId}`, { fields: pageFields }),
          warnings,
          "Grant pages_show_list/pages_read_engagement and ensure the Instagram account is linked to this Page.",
        );
        const context = { page_id: page?.id ?? pageId, page_name: page?.name };
        if (isRecord(page?.instagram_business_account)) {
          addById(accountsById, [
            normalizeInstagramAccount(page.instagram_business_account, "page.instagram_business_account", context),
          ]);
        }
        if (isRecord(page?.connected_instagram_account)) {
          addById(accountsById, [
            normalizeInstagramAccount(page.connected_instagram_account, "page.connected_instagram_account", context),
          ]);
        }
      }

      if (adAccountId) {
        const adAccountAccounts = await fetchGraph(
          client,
          "ad_account_instagram_accounts",
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/instagram_accounts`, {
            fields,
            limit,
            after: cursor,
          }),
          warnings,
          "Grant ads_read and instagram_basic, and confirm the IG account is available to the ad account.",
        );
        addById(accountsById, dataArray(adAccountAccounts).map((account) => normalizeInstagramAccount(account, "ad_account.instagram_accounts", { ad_account_id: formatAdAccountId(adAccountId) })));
        paging.ad_account_instagram_accounts = pagingInfo(adAccountAccounts);
      }

      if (businessId) {
        const owned = await fetchGraph(
          client,
          "owned_instagram_accounts",
          graphUrl(client, `/${businessId}/owned_instagram_accounts`, { fields, limit, after: cursor }),
          warnings,
          "Grant business_management and instagram_basic to read owned Instagram accounts.",
        );
        const clientAccounts = await fetchGraph(
          client,
          "client_instagram_accounts",
          graphUrl(client, `/${businessId}/client_instagram_accounts`, { fields, limit, after: cursor }),
          warnings,
          "Client Instagram account access may require partner permissions and instagram_basic.",
        );
        addById(accountsById, dataArray(owned).map((account) => normalizeInstagramAccount(account, "business.owned_instagram_accounts", { business_id: businessId })));
        addById(accountsById, dataArray(clientAccounts).map((account) => normalizeInstagramAccount(account, "business.client_instagram_accounts", { business_id: businessId })));
        paging.owned_instagram_accounts = pagingInfo(owned);
        paging.client_instagram_accounts = pagingInfo(clientAccounts);
      }

      if (!pageId && !adAccountId && !businessId) {
        const pages = await fetchGraph(
          client,
          "me_accounts_instagram",
          graphUrl(client, "/me/accounts", {
            fields: "id,name,instagram_business_account{id,username,name,ig_id,profile_picture_url},connected_instagram_account{id,username,name,ig_id,profile_picture_url}",
            limit,
            after: cursor,
          }),
          warnings,
          "Grant pages_show_list/pages_read_engagement and instagram_basic to discover IG accounts via Pages.",
        );
        for (const page of dataArray(pages)) {
          const context = { page_id: page.id, page_name: page.name };
          if (isRecord(page.instagram_business_account)) {
            addById(accountsById, [
              normalizeInstagramAccount(page.instagram_business_account, "me/accounts.instagram_business_account", context),
            ]);
          }
          if (isRecord(page.connected_instagram_account)) {
            addById(accountsById, [
              normalizeInstagramAccount(page.connected_instagram_account, "me/accounts.connected_instagram_account", context),
            ]);
          }
        }
        paging.me_accounts = pagingInfo(pages);
      }

      return ok({
        instagram_accounts: [...accountsById.values()],
        count: accountsById.size,
        paging,
        warnings,
      });
    },
  );

  // ── P0/P1. meta_get_pixels ────────────────────────────────────────
  server.tool(
    "meta_get_pixels",
    "List pixels and datasets from an ad account or Business Manager when accessible, returning actionable warnings for permission-limited edges.",
    {
      adAccountId: adAccountIdSchema.optional().describe("Ad account ID for /adspixels and offline conversion datasets."),
      businessId: z.string().optional().describe("Business Manager ID for owned/client pixels and datasets."),
      includeDatasets: z.boolean().optional().default(true).describe("Also attempt dataset/offline conversion dataset edges."),
      limit: z.number().int().min(1).max(200).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ adAccountId, businessId, includeDatasets, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const pixelsById = new Map<string, Record<string, unknown>>();
      const datasetsById = new Map<string, Record<string, unknown>>();
      const pixelFields = "id,name,last_fired_time,creation_time,owner_ad_account,business";
      const pixelFallbackFields = "id,name,last_fired_time,creation_time";
      const datasetFields = "id,name,description,creation_time,updated_time";
      const datasetFallbackFields = "id,name";
      const paging: Record<string, unknown> = {};

      if (!adAccountId && !businessId) {
        warnings.push({
          area: "pixels",
          message: "No adAccountId or businessId was provided.",
          suggestion: "Pass adAccountId for account pixels, or businessId for Business Manager-owned/client pixels.",
        });
      }

      if (adAccountId) {
        const pixels = await fetchGraphWithFallback(
          client,
          "ad_account_pixels",
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/adspixels`, {
            fields: pixelFields,
            limit,
            after: cursor,
          }),
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/adspixels`, {
            fields: pixelFallbackFields,
            limit,
            after: cursor,
          }),
          warnings,
          "Grant ads_read and ensure the token has access to the ad account's pixel assets.",
        );
        addById(pixelsById, dataArray(pixels));
        paging.ad_account_pixels = pagingInfo(pixels);

        if (includeDatasets) {
          const datasets = await fetchGraphWithFallback(
            client,
            "ad_account_offline_conversion_data_sets",
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/offline_conversion_data_sets`, {
              fields: datasetFields,
              limit,
              after: cursor,
            }),
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/offline_conversion_data_sets`, {
              fields: datasetFallbackFields,
              limit,
              after: cursor,
            }),
            warnings,
            "Offline datasets may require business-level asset access; try businessId if this edge is unavailable.",
          );
          addById(datasetsById, dataArray(datasets));
          paging.ad_account_offline_conversion_data_sets = pagingInfo(datasets);
        }
      }

      if (businessId) {
        const [ownedPixels, clientPixels] = await Promise.all([
          fetchGraphWithFallback(
            client,
            "business_owned_pixels",
            graphUrl(client, `/${businessId}/owned_pixels`, { fields: pixelFields, limit, after: cursor }),
            graphUrl(client, `/${businessId}/owned_pixels`, { fields: pixelFallbackFields, limit, after: cursor }),
            warnings,
            "Grant business_management and pixel asset permissions to read Business-owned pixels.",
          ),
          fetchGraphWithFallback(
            client,
            "business_client_pixels",
            graphUrl(client, `/${businessId}/client_pixels`, { fields: pixelFields, limit, after: cursor }),
            graphUrl(client, `/${businessId}/client_pixels`, { fields: pixelFallbackFields, limit, after: cursor }),
            warnings,
            "Client pixel access may require partner permissions in Business Manager.",
          ),
        ]);
        addById(pixelsById, dataArray(ownedPixels));
        addById(pixelsById, dataArray(clientPixels));
        paging.business_owned_pixels = pagingInfo(ownedPixels);
        paging.business_client_pixels = pagingInfo(clientPixels);

        if (includeDatasets) {
          const [ownedDatasets, clientDatasets] = await Promise.all([
            fetchGraphWithFallback(
              client,
              "business_owned_data_sets",
              graphUrl(client, `/${businessId}/owned_data_sets`, { fields: datasetFields, limit, after: cursor }),
              graphUrl(client, `/${businessId}/owned_data_sets`, { fields: datasetFallbackFields, limit, after: cursor }),
              warnings,
              "Dataset edges vary by Meta account setup; verify Business Manager asset permissions.",
            ),
            fetchGraphWithFallback(
              client,
              "business_client_data_sets",
              graphUrl(client, `/${businessId}/client_data_sets`, { fields: datasetFields, limit, after: cursor }),
              graphUrl(client, `/${businessId}/client_data_sets`, { fields: datasetFallbackFields, limit, after: cursor }),
              warnings,
              "Client dataset access may require partner permissions or may not be available for this business.",
            ),
          ]);
          addById(datasetsById, dataArray(ownedDatasets));
          addById(datasetsById, dataArray(clientDatasets));
          paging.business_owned_data_sets = pagingInfo(ownedDatasets);
          paging.business_client_data_sets = pagingInfo(clientDatasets);
        }
      }

      return ok({
        pixels: [...pixelsById.values()],
        datasets: [...datasetsById.values()],
        counts: {
          pixels: pixelsById.size,
          datasets: datasetsById.size,
        },
        paging,
        warnings,
      });
    },
  );

  // ── P0/P1. meta_get_ad_activity ───────────────────────────────────
  server.tool(
    "meta_get_ad_activity",
    "Read ad account activity logs from /{ad_account_id}/activities with object, event, actor, timestamp, and extra_data fields.",
    {
      adAccountId: adAccountIdSchema,
      since: z.string().optional().describe("Optional start time accepted by Graph API, usually YYYY-MM-DD or Unix seconds."),
      until: z.string().optional().describe("Optional end time accepted by Graph API, usually YYYY-MM-DD or Unix seconds."),
      limit: z.number().int().min(1).max(500).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ adAccountId, since, until, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const fields = "object_id,object_name,event_type,translated_event_type,event_time,actor_id,actor_name,extra_data";
      const result = await fetchGraph(
        client,
        "ad_activity",
        graphUrl(client, `/${formatAdAccountId(adAccountId)}/activities`, {
          fields,
          since,
          until,
          limit,
          after: cursor,
        }),
        warnings,
        "Grant ads_read and confirm the token user can view activity history for this ad account.",
      );
      const activities = dataArray(result).map((activity) => ({
        ...activity,
        actor: {
          id: activity.actor_id,
          name: activity.actor_name,
        },
      }));

      return ok({
        activities,
        count: activities.length,
        paging: pagingInfo(result),
        warnings,
      });
    },
  );

  // ── P0/P1. meta_get_delivery_diagnostics ──────────────────────────
  server.tool(
    "meta_get_delivery_diagnostics",
    "Aggregate read-only delivery diagnostics across campaigns, ad sets, and ads using status/effective_status/issues_info where available plus simple delivery insights.",
    {
      adAccountId: adAccountIdSchema,
      level: z.enum(["campaign", "adset", "ad", "all"]).optional().default("all"),
      effectiveStatusFilter: z.array(z.string()).optional().describe("Optional effective_status filter values such as ACTIVE, PAUSED, WITH_ISSUES, DISAPPROVED."),
      datePreset: datePresetSchema.describe("Insights date preset for simple delivery metrics. Defaults to last_7d."),
      timeRange: timeRangeSchema.describe("Optional custom insights date range."),
      limit: z.number().int().min(1).max(200).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ adAccountId, level, effectiveStatusFilter, datePreset, timeRange, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const diagnostics: Record<string, unknown> = {};
      const simpleInsights: Record<string, unknown> = {};
      const paging: Record<string, unknown> = {};
      const selectedLevels = level === "all" ? ["campaign", "adset", "ad"] as const : [level] as const;
      const edges = {
        campaign: "campaigns",
        adset: "adsets",
        ad: "ads",
      } as const;
      const richFields = {
        campaign: "id,name,status,effective_status,configured_status,objective,buying_type,issues_info,start_time,stop_time,created_time,updated_time",
        adset: "id,name,status,effective_status,configured_status,campaign_id,optimization_goal,billing_event,issues_info,learning_stage_info,start_time,end_time,daily_budget,lifetime_budget,created_time,updated_time",
        ad: "id,name,status,effective_status,configured_status,adset_id,campaign_id,issues_info,creative{id,name,thumbnail_url},created_time,updated_time",
      } as const;
      const fallbackFields = {
        campaign: "id,name,status,effective_status,objective,start_time,stop_time",
        adset: "id,name,status,effective_status,campaign_id,optimization_goal,start_time,end_time",
        ad: "id,name,status,effective_status,adset_id,campaign_id,creative{id,name}",
      } as const;
      const insightFields = {
        campaign: ["campaign_id", "campaign_name", "impressions", "reach", "spend", "clicks", "ctr"],
        adset: ["campaign_id", "campaign_name", "adset_id", "adset_name", "impressions", "reach", "spend", "clicks", "ctr"],
        ad: ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "impressions", "reach", "spend", "clicks", "ctr"],
      } as const;

      if (level === "all" && cursor) {
        warnings.push({
          area: "pagination",
          message: "A single cursor was provided while level=all.",
          suggestion: "Use a specific level with the returned paging cursor for precise pagination.",
        });
      }

      for (const entityLevel of selectedLevels) {
        const filters = effectiveStatusFilter?.length
          ? JSON.stringify([{ field: "effective_status", operator: "IN", value: effectiveStatusFilter }])
          : undefined;
        const result = await fetchGraphWithFallback(
          client,
          `delivery_${entityLevel}`,
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/${edges[entityLevel]}`, {
            fields: richFields[entityLevel],
            filtering: filters,
            limit,
            after: cursor,
          }),
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/${edges[entityLevel]}`, {
            fields: fallbackFields[entityLevel],
            filtering: filters,
            limit,
            after: cursor,
          }),
          warnings,
          "Some diagnostic fields are permission/version dependent; minimal status fields are returned when rich fields are unavailable.",
        );

        diagnostics[`${edges[entityLevel]}`] = dataArray(result).map(entityIssueSummary);
        paging[edges[entityLevel]] = pagingInfo(result);

        try {
          simpleInsights[entityLevel] = await client.fetchInsights(formatAdAccountId(adAccountId), {
            type: "delivery_diagnostics",
            fields: [...insightFields[entityLevel]],
            level: entityLevel,
            limit,
            datePreset: timeRange ? undefined : (datePreset ?? "last_7d"),
            timeRange,
          });
        } catch (error) {
          warnings.push(warningFromError(
            `delivery_${entityLevel}_insights`,
            error,
            "Simple delivery insights are optional; verify ads_read and metric availability for this account.",
          ));
        }
      }

      return ok({
        ad_account_id: formatAdAccountId(adAccountId),
        date_range: timeRange ?? { date_preset: datePreset ?? "last_7d" },
        diagnostics,
        simple_insights: simpleInsights,
        paging,
        warnings: [
          {
            area: "delivery_diagnostics",
            message: "Meta does not expose one stable read-only delivery diagnostics endpoint for every issue type.",
            suggestion: "Use effective_status, issues_info when present, learning_stage_info when present, and insights together to triage delivery.",
          },
          ...warnings,
        ],
      });
    },
  );

  // ── P0/P1. meta_get_creative_assets ───────────────────────────────
  server.tool(
    "meta_get_creative_assets",
    "Return ad-linked creative media with actual ad names, collection covers, all carousel/flexible components, resolved image hashes and video URLs. Catalog-only ads are classified separately; use the hosted GetMCPAds service for an interactive visual gallery. Raw creative metadata remains available for diagnostics.",
    {
      adAccountId: adAccountIdSchema.optional().describe("Ad account ID. Used when adIds/creativeIds are omitted."),
      adIds: z.array(z.string()).optional().describe("Specific ad IDs to enrich."),
      creativeIds: z.array(z.string()).optional().describe("Specific creative IDs to enrich."),
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, adIds, creativeIds, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const creativeFields = "id,name,body,title,thumbnail_url,image_url,image_hash,video_id,product_set_id,link_url,call_to_action_type,effective_object_story_id,object_type,object_story_spec,asset_feed_spec";
      const adFields = `id,name,account_id,status,effective_status,campaign_id,adset_id,creative{${creativeFields}}`;
      let sourceType: "ad" | "creative" = "ad";
      let result: Record<string, unknown> | null = null;
      const idChunkSize = 50;

      if (creativeIds && creativeIds.length > 0) {
        sourceType = "creative";
        const merged: Record<string, unknown> = {};
        for (const id of creativeIds.slice(0,20)) {
          const creative = await fetchGraph(client,"creative_node",graphUrl(client,`/${encodeURIComponent(id)}`,{fields:creativeFields}),warnings,"Verify creative access, or use adIds with adAccountId for ad names.");
          if(creative) merged[id]=creative;
        }
        result=merged;
        if(creativeIds.length>20) warnings.push({area:"creative_assets",message:"Only 20 creative IDs resolved.",suggestion:"Use batches of 20 creative IDs, or adIds with adAccountId."});
      } else if (adIds && adIds.length > 0 && !adAccountId) {
        const merged: Record<string, unknown> = {};
        for (const id of adIds.slice(0, 20)) {
          const ad = await fetchGraph(client,"ad_creative",graphUrl(client,`/${encodeURIComponent(id)}`,{fields:adFields}),warnings,"Provide the owning adAccountId for efficient targeted ad lookup.");
          if (ad) merged[id] = ad;
        }
        if(adIds.length>20) warnings.push({area:"creative_assets",message:"Only 20 ad IDs resolved without an account.",suggestion:"Provide adAccountId to resolve the full selection."});
        result=merged;
      } else if (adIds && adIds.length > 0) {
        sourceType = "ad";
        const merged: Record<string, unknown> = {};
        for (let index = 0; index < adIds.length; index += idChunkSize) {
          const chunk = adIds.slice(index, index + idChunkSize);
          const chunkResult = await fetchGraph(
            client,
            `ad_ids_creatives_${Math.floor(index / idChunkSize) + 1}`,
            graphUrl(client, `/${formatAdAccountId(adAccountId!)}/ads`, { filtering: JSON.stringify([{field:"id",operator:"IN",value:chunk}]), fields: adFields, limit: 500 }),
            warnings,
            "Verify the ad IDs are readable by this token and belong to accessible ad accounts.",
          );
          for (const ad of dataArray(chunkResult)) if (ad.id) merged[String(ad.id)] = ad;
        }
        const missingIds = adIds.filter(id => !merged[id]);
        // Account inventory can omit archived/deleted ads still present in
        // historical insights. Read those exact nodes rather than invent media.
        for (const id of missingIds.slice(0, 10)) {
          const ad = await fetchGraph(client,"historical_ad_creative",graphUrl(client,`/${encodeURIComponent(id)}`,{fields:adFields}),warnings,"Historical ad metadata may no longer be accessible.");
          if (ad && typeof ad.account_id === "string" && formatAdAccountId(ad.account_id) === formatAdAccountId(adAccountId!)) merged[id] = ad;
          else if (ad) warnings.push({area:"creative_assets",message:`Ad ${id} was excluded because its owning account could not be verified against the requested account.`,suggestion:"Use an ad from the selected account."});
        }
        if (missingIds.length > 10) warnings.push({area:"creative_assets",message:"Historical ad fallback limited to 10 missing ads.",suggestion:"Narrow the ad selection to resolve additional historical ads."});
        result = merged;
        if (adIds.length > idChunkSize) {
          warnings.push({
            area: "creative_assets",
            message: `Ad ID creative enrichment was chunked into batches of ${idChunkSize} to avoid oversized Graph API responses.`,
            suggestion: "Pass adIds from the spend-ranked insights rows to cover all spend-bearing ads without broad account paging.",
          });
        }
      } else if (adAccountId) {
        sourceType = "ad";
        result = await fetchGraph(
          client,
          "ad_account_creative_assets",
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/ads`, {
            fields: adFields,
            limit,
            after: cursor,
          }),
          warnings,
          "Pass adIds/creativeIds directly or grant ads_read for the ad account.",
        );
      } else {
        warnings.push({
          area: "creative_assets",
          message: "No adAccountId, adIds, or creativeIds were provided.",
          suggestion: "Pass adAccountId to list ad creatives, or pass adIds/creativeIds for targeted enrichment.",
        });
      }

      const records = result?.data
        ? dataArray(result)
        : Object.values(result ?? {}).filter(isRecord);
      const assets = records.map((record) => normalizeCreativeAsset(record, sourceType));
      // Resolve hashes and videos without replacing individual carousel media
      // with the parent creative's (possibly product) thumbnail.
      const allMedia = assets.flatMap(asset => Array.isArray(asset.media) ? asset.media as import("./creative-media.js").MetaMedia[] : []);
      // Always refresh hashes, even when Meta also returns a stale/small preview.
      const hashes = [...new Set(allMedia.filter(m => m.image_hash).map(m => m.image_hash!))];
      if (hashes.length && adAccountId) {
        for (let offset = 0; offset < hashes.length; offset += 50) {
          const images = await fetchGraph(client, "creative_image_hashes", graphUrl(client, `/${formatAdAccountId(adAccountId)}/adimages`, {
            hashes: JSON.stringify(hashes.slice(offset, offset + 50)), fields: "hash,permalink_url,url", limit: 50,
          }), warnings, "Verify ads_read access to the ad account image library.");
          for (const image of dataArray(images)) for (const item of allMedia) if (item.image_hash === image.hash) item.image_url = metaImageFileUrl(image.url, image.permalink_url, item.image_url);
        }
      }
      const videoIds = [...new Set(allMedia.map(m => m.video_id).filter((id): id is string => Boolean(id)))];
      const pageClientFor = pageClientResolver(client, warnings);
      for (const id of videoIds.slice(0, 10)) {
        const video = await fetchGraph(client, "creative_video", graphUrl(client, `/${encodeURIComponent(id)}`, {fields:"id,picture,source,from"}), warnings,
          "Verify access to the ad video and its owning Page.") ?? {id};
        const owner = assets.find(asset => (asset.media as import("./creative-media.js").MetaMedia[]).some(m => m.video_id === id));
        const pageId = firstString(isRecord(video.from) ? video.from.id : undefined, owner?.page_id,
          typeof owner?.effective_object_story_id === "string" ? owner.effective_object_story_id.split("_")[0] : undefined);
        if (!video.source && pageId) {
          const pageClient=await pageClientFor(pageId);
          if (pageClient) {
            const resolved=await fetchGraph(pageClient,"creative_page_video",graphUrl(pageClient,`/${encodeURIComponent(id)}`,{fields:"id,picture,source"}),warnings,"Verify Page content access.");
            if(resolved) Object.assign(video,resolved);
          }
        }
        for (const item of allMedia) if (item.video_id === id) {
          item.thumbnail_url = firstString(video?.picture, item.thumbnail_url);
          item.source = firstString(video?.source, item.source);
        }
        if (!video.source) warnings.push({area:"creative_video",message:`No playable source returned for video ${id}. A cover is not evidence of the full video.`,suggestion:"Check the connected profile's access to the owning Page; re-resolve this video before playback or analysis."});
      }
      if (videoIds.length > 10) warnings.push({area:"creative_video",message:"Video URL resolution limited to 10 videos.",suggestion:"Narrow the ad selection or use meta_get_video_sources to resolve additional videos."});

      const paging = pagingInfo(result);
      if (paging) {
        warnings.push({
          area: "creative_assets",
          message: "Creative assets response is paginated.",
          suggestion: "Use the returned paging cursor for the next page, or pass explicit adIds from insights for deterministic creative-to-site coverage.",
        });
      }

      return ok({
        assets,
        count: assets.length,
        paging,
        warnings,
      });
    },
  );

  // ── P0/P1. meta_get_audience_details ──────────────────────────────
  server.tool(
    "meta_get_audience_details",
    "Read detailed custom, saved, and lookalike audiences with pagination and rich fields where permissions allow.",
    {
      adAccountId: adAccountIdSchema.optional().describe("Ad account ID used when listing audiences."),
      audienceIds: z.array(z.string()).optional().describe("Specific audience IDs to fetch via batch IDs lookup."),
      type: z.enum(["all", "custom", "saved", "lookalike"]).optional().default("all"),
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, audienceIds, type, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const customAudiences: Record<string, unknown>[] = [];
      const savedAudiences: Record<string, unknown>[] = [];
      const lookalikeAudiences: Record<string, unknown>[] = [];
      const paging: Record<string, unknown> = {};
      const customFields = [
        "id",
        "name",
        "description",
        "subtype",
        "approximate_count_lower_bound",
        "approximate_count_upper_bound",
        "delivery_status",
        "operation_status",
        "permission_for_actions",
        "lookalike_spec",
        "lookalike_audience_ids",
        "customer_file_source",
        "retention_days",
        "time_created",
        "time_updated",
        "data_source",
        "rule",
        "account_id",
      ].join(",");
      const customFallbackFields = "id,name,description,subtype,delivery_status,time_created,time_updated";
      const savedFields = "id,name,description,targeting,account_id,time_created,time_updated,run_status";
      const savedFallbackFields = "id,name,description,targeting";

      if (audienceIds && audienceIds.length > 0) {
        const fields = type === "saved" ? savedFields : customFields;
        const fallbackFields = type === "saved" ? savedFallbackFields : customFallbackFields;
        const result = await fetchGraphWithFallback(
          client,
          "audience_ids",
          graphUrl(client, "", { ids: audienceIds.join(","), fields }),
          graphUrl(client, "", { ids: audienceIds.join(","), fields: fallbackFields }),
          warnings,
          "Some audience detail fields are restricted; minimal audience fields are returned when rich fields fail.",
        );
        for (const audience of Object.values(result ?? {}).filter(isRecord)) {
          if (audience.subtype === "LOOKALIKE") {
            lookalikeAudiences.push(audience);
          } else if (type === "saved" || audience.targeting) {
            savedAudiences.push(audience);
          } else {
            customAudiences.push(audience);
          }
        }
      } else if (!adAccountId) {
        warnings.push({
          area: "audiences",
          message: "No adAccountId or audienceIds were provided.",
          suggestion: "Pass adAccountId to list audiences, or audienceIds for targeted details.",
        });
      } else {
        if (type === "all" && cursor) {
          warnings.push({
            area: "pagination",
            message: "A single cursor was provided while type=all.",
            suggestion: "Use type=custom, type=lookalike, or type=saved with the returned cursor for precise pagination.",
          });
        }

        if (type === "all" || type === "custom" || type === "lookalike") {
          const filtering = type === "lookalike"
            ? JSON.stringify([{ field: "subtype", operator: "EQUAL", value: "LOOKALIKE" }])
            : undefined;
          const result = await fetchGraphWithFallback(
            client,
            "customaudiences",
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/customaudiences`, {
              fields: customFields,
              filtering,
              limit,
              after: cursor,
            }),
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/customaudiences`, {
              fields: customFallbackFields,
              filtering,
              limit,
              after: cursor,
            }),
            warnings,
            "Grant ads_read and audience asset access. Some audience detail fields are restricted by Meta privacy rules.",
          );
          for (const audience of dataArray(result)) {
            if (audience.subtype === "LOOKALIKE") {
              lookalikeAudiences.push(audience);
            } else {
              customAudiences.push(audience);
            }
          }
          paging.customaudiences = pagingInfo(result);
        }

        if (type === "all" || type === "saved") {
          const result = await fetchGraphWithFallback(
            client,
            "saved_audiences",
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/saved_audiences`, {
              fields: savedFields,
              limit,
              after: cursor,
            }),
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/saved_audiences`, {
              fields: savedFallbackFields,
              limit,
              after: cursor,
            }),
            warnings,
            "Grant ads_read and ensure the token user can read saved audiences for this account.",
          );
          savedAudiences.push(...dataArray(result));
          paging.saved_audiences = pagingInfo(result);
        }
      }

      return ok({
        custom_audiences: customAudiences,
        saved_audiences: savedAudiences,
        lookalike_audiences: lookalikeAudiences,
        counts: {
          custom_audiences: customAudiences.length,
          saved_audiences: savedAudiences.length,
          lookalike_audiences: lookalikeAudiences.length,
        },
        paging,
        warnings,
      });
    },
  );

  // ── P2. meta_get_catalog_products ────────────────────────────────
  server.tool(
    "meta_get_catalog_products",
    "Read Product Catalogs and Product Items when catalog access is available. Returns join-ready product metadata without creating or updating catalog assets.",
    {
      businessId: z.string().optional().describe("Business Manager ID used to discover owned/client product catalogs."),
      catalogId: z.string().optional().describe("Product Catalog ID to read directly."),
      productIds: z.array(z.string()).max(100).optional().describe("Specific Product Item IDs to fetch via the batch IDs endpoint."),
      search: z.string().optional().describe("Client-side substring filter across product id, retailer_id, name, brand, category, type, and custom labels."),
      includeProducts: z.boolean().optional().default(true).describe("Fetch product items for discovered/provided catalogs."),
      includeProductSets: z.boolean().optional().default(false).describe("Also attempt product_sets edges for catalog context."),
      limit: z.number().int().min(1).max(500).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ businessId, catalogId, productIds, search, includeProducts, includeProductSets, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const catalogsById = new Map<string, Record<string, unknown>>();
      const productsById = new Map<string, Record<string, unknown>>();
      const productSetsById = new Map<string, Record<string, unknown>>();
      const paging: Record<string, unknown> = {};
      const catalogFields = "id,name,vertical,product_count,feed_count,business,default_image_url,fallback_image_url";
      const catalogFallbackFields = "id,name,vertical,product_count";
      const productFields = [
        "id",
        "retailer_id",
        "name",
        "description",
        "brand",
        "category",
        "fb_product_category",
        "product_type",
        "price",
        "sale_price",
        "currency",
        "availability",
        "inventory",
        "visibility",
        "review_status",
        "url",
        "image_url",
        "additional_image_urls",
        "custom_label_0",
        "custom_label_1",
        "custom_label_2",
        "custom_label_3",
        "custom_label_4",
        "retailer_product_group_id",
        "product_catalog{id,name}",
        "product_group{id}",
      ].join(",");
      const productFallbackFields = "id,retailer_id,name,brand,price,availability,url,image_url";
      const productSetFields = "id,name,filter,product_count";

      if (!businessId && !catalogId && (!productIds || productIds.length === 0)) {
        warnings.push({
          area: "catalog_products",
          message: "No businessId, catalogId, or productIds were provided.",
          suggestion: "Pass catalogId for a direct read, businessId to discover catalogs, or productIds for targeted enrichment.",
        });
      }

      if (productIds && productIds.length > 0) {
        const products = await fetchGraphWithFallback(
          client,
          "catalog_product_ids",
          graphUrl(client, "", { ids: productIds.join(","), fields: productFields }),
          graphUrl(client, "", { ids: productIds.join(","), fields: productFallbackFields }),
          warnings,
          "Product Item reads may require catalog asset access. Verify catalog permissions if rich fields are unavailable.",
        );
        for (const product of Object.values(products ?? {}).filter(isRecord)) {
          const normalized = normalizeProductItem(product, "ids");
          if (productSearchMatches(normalized, search)) {
            productsById.set(String(normalized.id ?? normalized.retailer_id), normalized);
          }
        }
      }

      if (catalogId) {
        const catalog = await fetchGraphWithFallback(
          client,
          "catalog",
          graphUrl(client, `/${catalogId}`, { fields: catalogFields }),
          graphUrl(client, `/${catalogId}`, { fields: catalogFallbackFields }),
          warnings,
          "Verify the token has access to this Product Catalog. Some catalog fields are permission/version dependent.",
        );
        if (catalog) catalogsById.set(String(catalog.id ?? catalogId), catalog);
      }

      if (businessId) {
        const [ownedCatalogs, clientCatalogs] = await Promise.all([
          fetchGraphWithFallback(
            client,
            "business_owned_product_catalogs",
            graphUrl(client, `/${businessId}/owned_product_catalogs`, { fields: catalogFields, limit, after: cursor }),
            graphUrl(client, `/${businessId}/owned_product_catalogs`, { fields: catalogFallbackFields, limit, after: cursor }),
            warnings,
            "Grant business_management and catalog asset access to read Business-owned product catalogs.",
          ),
          fetchGraphWithFallback(
            client,
            "business_client_product_catalogs",
            graphUrl(client, `/${businessId}/client_product_catalogs`, { fields: catalogFields, limit, after: cursor }),
            graphUrl(client, `/${businessId}/client_product_catalogs`, { fields: catalogFallbackFields, limit, after: cursor }),
            warnings,
            "Client catalog access may require partner permissions or a catalog-capable token.",
          ),
        ]);
        addById(catalogsById, dataArray(ownedCatalogs));
        addById(catalogsById, dataArray(clientCatalogs));
        paging.business_owned_product_catalogs = pagingInfo(ownedCatalogs);
        paging.business_client_product_catalogs = pagingInfo(clientCatalogs);
      }

      const catalogIds = [...catalogsById.keys()];
      if (includeProducts) {
        if (catalogIds.length > 1 && cursor) {
          warnings.push({
            area: "catalog_products_pagination",
            message: "A single cursor was provided while multiple catalogs are being read.",
            suggestion: "Use catalogId with the returned catalog-specific cursor for precise product pagination.",
          });
        }

        for (const id of catalogIds) {
          const products = await fetchGraphWithFallback(
            client,
            `catalog:${id}:products`,
            graphUrl(client, `/${id}/products`, { fields: productFields, limit, after: cursor }),
            graphUrl(client, `/${id}/products`, { fields: productFallbackFields, limit, after: cursor }),
            warnings,
            "Product Item fields may require catalog permissions. Minimal join fields are returned when rich product fields fail.",
          );
          const normalizedProducts = dataArray(products)
            .map((product) => normalizeProductItem(product, `catalog:${id}:products`))
            .filter((product) => productSearchMatches(product, search));
          addById(productsById, normalizedProducts);
          paging[`catalog:${id}:products`] = pagingInfo(products);
        }
      }

      if (includeProductSets) {
        for (const id of catalogIds) {
          const productSets = await fetchGraph(
            client,
            `catalog:${id}:product_sets`,
            graphUrl(client, `/${id}/product_sets`, { fields: productSetFields, limit, after: cursor }),
            warnings,
            "Product set reads may require catalog access, and some catalog verticals do not expose product_sets.",
          );
          addById(productSetsById, dataArray(productSets));
          paging[`catalog:${id}:product_sets`] = pagingInfo(productSets);
        }
      }

      return ok({
        catalogs: [...catalogsById.values()],
        products: [...productsById.values()],
        product_sets: [...productSetsById.values()],
        counts: {
          catalogs: catalogsById.size,
          products: productsById.size,
          product_sets: productSetsById.size,
        },
        join_keys: [
          "product.id",
          "product.retailer_id",
          "retailer_product_group_id",
          "brand",
          "category",
          "product_type",
          "custom_label_0..4",
        ],
        paging,
        warnings,
      });
    },
  );

  // ── P2. meta_join_product_insights ────────────────────────────────
  server.tool(
    "meta_join_product_insights",
    "Query product-breakdown insights and enrich rows with Product Catalog metadata when catalog access is available.",
    {
      adAccountId: adAccountIdSchema,
      catalogId: z.string().optional().describe("Product Catalog ID used to load product metadata for joins."),
      productBreakdown: productBreakdownSchema.optional().default("product_id"),
      metrics: z.array(z.string()).min(1).optional().default(["impressions", "clicks", "spend", "actions", "action_values"]),
      level: levelSchema.optional().default("ad"),
      datePreset: datePresetSchema.describe("Insights date preset. Defaults to last_30d."),
      timeRange: timeRangeSchema.describe("Optional custom insights date range."),
      limit: z.number().int().min(1).max(1000).optional().default(500),
      catalogProductLimit: z.number().int().min(1).max(1000).optional().default(500),
    },
    async ({ adAccountId, catalogId, productBreakdown, metrics, level, datePreset, timeRange, limit, catalogProductLimit }) => {
      const warnings: MetaWarning[] = [];
      const insightFields = Array.from(new Set([
        "campaign_id",
        "campaign_name",
        "adset_id",
        "adset_name",
        "ad_id",
        "ad_name",
        ...metrics,
      ]));
      let insightRows: Record<string, unknown>[] = [];
      const products: Record<string, unknown>[] = [];
      const productFields = [
        "id",
        "retailer_id",
        "name",
        "brand",
        "category",
        "fb_product_category",
        "product_type",
        "price",
        "sale_price",
        "currency",
        "availability",
        "inventory",
        "url",
        "image_url",
        "custom_label_0",
        "custom_label_1",
        "custom_label_2",
        "custom_label_3",
        "custom_label_4",
        "retailer_product_group_id",
        "product_catalog{id,name}",
        "product_group{id}",
      ].join(",");
      const productFallbackFields = "id,retailer_id,name,brand,price,availability,url,image_url";

      try {
        insightRows = (await client.fetchInsights(formatAdAccountId(adAccountId), {
          type: "product_insights_join",
          fields: insightFields,
          level,
          limit,
          datePreset: timeRange ? undefined : (datePreset ?? "last_30d"),
          timeRange,
          breakdowns: [productBreakdown],
        })).filter(isRecord);
      } catch (error) {
        warnings.push(warningFromError(
          "product_insights",
          error,
          "Product breakdowns are not available for every objective, catalog setup, or metric set. Try product_id with basic delivery metrics first.",
        ));
      }

      if (catalogId) {
        const catalogProducts = await fetchGraphWithFallback(
          client,
          "catalog_products_for_join",
          graphUrl(client, `/${catalogId}/products`, { fields: productFields, limit: catalogProductLimit }),
          graphUrl(client, `/${catalogId}/products`, { fields: productFallbackFields, limit: catalogProductLimit }),
          warnings,
          "Catalog product enrichment requires catalog asset access. Insight rows are still returned when catalog reads fail.",
        );
        products.push(
          ...dataArray(catalogProducts).map((product) => normalizeProductItem(product, `catalog:${catalogId}:products`)),
        );
      } else {
        warnings.push({
          area: "catalog_join",
          message: "No catalogId was provided, so insight rows cannot be enriched with Product Catalog metadata.",
          suggestion: "Run meta_get_catalog_products with businessId to discover a catalogId, then rerun this tool.",
        });
      }

      const lookup = buildProductLookup(products, productBreakdown);
      let matchedRows = 0;
      const enrichedRows = insightRows.map((row) => {
        const key = typeof row[productBreakdown] === "string" ? row[productBreakdown] : undefined;
        const matches = key ? lookup.get(key) ?? [] : [];
        if (matches.length > 0) matchedRows += 1;
        return {
          ...row,
          catalog_join: {
            breakdown: productBreakdown,
            key,
            matched: matches.length > 0,
            match_count: matches.length,
            product_group: key && matches.length > 0 ? summarizeProductGroup(key, matches) : undefined,
          },
        };
      });

      return ok({
        ad_account_id: formatAdAccountId(adAccountId),
        date_range: timeRange ?? { date_preset: datePreset ?? "last_30d" },
        product_breakdown: productBreakdown,
        rows: enrichedRows,
        counts: {
          insight_rows: insightRows.length,
          matched_rows: matchedRows,
          unmatched_rows: insightRows.length - matchedRows,
          catalog_products_loaded: products.length,
        },
        warnings,
      });
    },
  );

  // ── P2. meta_get_brand_safety_controls ────────────────────────────
  server.tool(
    "meta_get_brand_safety_controls",
    "Read brand safety, suitability, placement, and context-control signals from ad account/ad set targeting and optional block-list edges.",
    {
      adAccountId: adAccountIdSchema,
      businessId: z.string().optional().describe("Optional Business Manager ID for block-list discovery."),
      adsetIds: z.array(z.string()).max(100).optional().describe("Specific ad set IDs to inspect. If omitted, reads ad sets from the ad account."),
      includeAdsets: z.boolean().optional().default(true),
      includeBlockLists: z.boolean().optional().default(true),
      includeRawTargeting: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(500).optional().default(100),
      cursor: cursorSchema,
    },
    async ({ adAccountId, businessId, adsetIds, includeAdsets, includeBlockLists, includeRawTargeting, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const blockListsById = new Map<string, Record<string, unknown>>();
      const paging: Record<string, unknown> = {};
      const account = await fetchGraph(
        client,
        "brand_safety_ad_account",
        graphUrl(client, `/${formatAdAccountId(adAccountId)}`, { fields: "id,name,account_status,business{id,name}" }),
        warnings,
        "Grant ads_read and confirm the token can read this ad account.",
      );
      const adsetFields = "id,name,status,effective_status,campaign_id,targeting,optimization_goal,billing_event,promoted_object";
      const adsetFallbackFields = "id,name,status,effective_status,campaign_id,targeting";
      const blockListFields = "id,name,owner_business,created_time,updated_time";

      let adsets: Record<string, unknown>[] = [];
      if (includeAdsets) {
        if (adsetIds && adsetIds.length > 0) {
          const result = await fetchGraphWithFallback(
            client,
            "brand_safety_adset_ids",
            graphUrl(client, "", { ids: adsetIds.join(","), fields: adsetFields }),
            graphUrl(client, "", { ids: adsetIds.join(","), fields: adsetFallbackFields }),
            warnings,
            "Some ad set targeting fields are permission/version dependent; minimal targeting is returned when rich fields fail.",
          );
          adsets = Object.values(result ?? {}).filter(isRecord);
        } else {
          const result = await fetchGraphWithFallback(
            client,
            "brand_safety_adsets",
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/adsets`, {
              fields: adsetFields,
              limit,
              after: cursor,
            }),
            graphUrl(client, `/${formatAdAccountId(adAccountId)}/adsets`, {
              fields: adsetFallbackFields,
              limit,
              after: cursor,
            }),
            warnings,
            "Some ad set targeting fields are permission/version dependent; minimal targeting is returned when rich fields fail.",
          );
          adsets = dataArray(result);
          paging.adsets = pagingInfo(result);
        }
      }

      if (includeBlockLists) {
        const adAccountBlockLists = await fetchGraph(
          client,
          "ad_account_publisher_block_lists",
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/publisher_block_lists`, {
            fields: blockListFields,
            limit,
            after: cursor,
          }),
          warnings,
          "Publisher/content block-list Graph edges are not available for every account, API version, or rollout. Use Business Manager Brand Safety and Suitability Center when this edge is unavailable.",
        );
        addById(blockListsById, dataArray(adAccountBlockLists));
        paging.ad_account_publisher_block_lists = pagingInfo(adAccountBlockLists);

        if (businessId) {
          const [ownedBlockLists, clientBlockLists] = await Promise.all([
            fetchGraph(
              client,
              "business_owned_publisher_block_lists",
              graphUrl(client, `/${businessId}/owned_publisher_block_lists`, {
                fields: blockListFields,
                limit,
                after: cursor,
              }),
              warnings,
              "Owned publisher block-list edges are rollout/permission dependent; verify business_management and Brand Safety Center access.",
            ),
            fetchGraph(
              client,
              "business_client_publisher_block_lists",
              graphUrl(client, `/${businessId}/client_publisher_block_lists`, {
                fields: blockListFields,
                limit,
                after: cursor,
              }),
              warnings,
              "Client publisher block-list edges may require partner permissions and may not be exposed for this business.",
            ),
          ]);
          addById(blockListsById, dataArray(ownedBlockLists));
          addById(blockListsById, dataArray(clientBlockLists));
          paging.business_owned_publisher_block_lists = pagingInfo(ownedBlockLists);
          paging.business_client_publisher_block_lists = pagingInfo(clientBlockLists);
        }
      }

      return ok({
        ad_account_id: formatAdAccountId(adAccountId),
        account,
        adset_context_controls: adsets.map((adset) => ({
          ...summarizeBrandSafetyTargeting(adset),
          raw_targeting: includeRawTargeting ? adset.targeting : undefined,
        })),
        publisher_block_lists: [...blockListsById.values()],
        counts: {
          adsets: adsets.length,
          publisher_block_lists: blockListsById.size,
        },
        notes: [
          "Brand safety Graph coverage varies by account, region, and rollout.",
          "This tool only reads ad set targeting and block-list metadata; it does not create, upload, apply, or remove controls.",
        ],
        paging,
        warnings,
      });
    },
  );

  // ── P2. meta_interpret_experiment_results ─────────────────────────
  server.tool(
    "meta_interpret_experiment_results",
    "Read and interpret A/B test or conversion lift study results with confidence guardrails, cells, objectives, and optional cell entities.",
    {
      studyId: z.string().optional().describe("Specific Ad Study ID to interpret."),
      adAccountId: adAccountIdSchema.optional().describe("Ad account ID used to discover ad_studies when studyId is omitted."),
      includeCellEntities: z.boolean().optional().default(false).describe("Also read campaigns/adsets/adaccounts attached to each study cell."),
      cellEntityType: z.enum(["campaigns", "adsets", "adaccounts"]).optional().default("campaigns"),
      limit: z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ studyId, adAccountId, includeCellEntities, cellEntityType, limit }) => {
      const warnings: MetaWarning[] = [];
      const studiesById = new Map<string, Record<string, unknown>>();
      const studyFields = [
        "id",
        "name",
        "type",
        "description",
        "created_time",
        "start_time",
        "end_time",
        "results_first_available_date",
        "canceled_time",
        "observation_end_time",
        "cooldown_start_time",
      ].join(",");
      const objectiveFields = "id,name,type,is_primary,last_updated_results,results,custom_attributes";
      const objectiveFallbackFields = "id,name,type,is_primary,last_updated_results";
      const cellFields = "id,name,treatment_percentage,control_percentage,ad_entities_count";

      if (studyId) {
        const study = await fetchGraph(
          client,
          "ad_study",
          graphUrl(client, `/${studyId}`, { fields: studyFields }),
          warnings,
          "Verify the Ad Study ID is readable by this token.",
        );
        studiesById.set(studyId, study ?? { id: studyId });
      }

      if (!studyId && adAccountId) {
        const accountStudies = await fetchGraph(
          client,
          "ad_account_ad_studies",
          graphUrl(client, `/${formatAdAccountId(adAccountId)}/ad_studies`, {
            fields: studyFields,
            limit,
          }),
          warnings,
          "Ad Study account edges are permission dependent. Verify ads_read and experiment access for this account.",
        );
        addById(studiesById, dataArray(accountStudies));

        const accountBusiness = await fetchGraph(
          client,
          "ad_study_account_business",
          graphUrl(client, `/${formatAdAccountId(adAccountId)}`, { fields: "business{id,name}" }),
          warnings,
          "Business-level study fallback requires business access on the ad account.",
        );
        const business = isRecord(accountBusiness?.business) ? accountBusiness.business : undefined;
        if (typeof business?.id === "string") {
          const businessStudies = await fetchGraph(
            client,
            "business_ad_studies",
            graphUrl(client, `/${business.id}/ad_studies`, {
              fields: studyFields,
              limit,
            }),
            warnings,
            "Business ad_studies may require business_management or experiment access.",
          );
          addById(studiesById, dataArray(businessStudies));
        }

        const meStudies = await fetchGraph(
          client,
          "me_ad_studies",
          graphUrl(client, "/me/ad_studies", {
            fields: studyFields,
            limit,
          }),
          warnings,
          "The /me/ad_studies fallback is not available for every token or app mode.",
        );
        addById(studiesById, dataArray(meStudies));
      }

      if (!studyId && !adAccountId) {
        warnings.push({
          area: "ad_studies",
          message: "No studyId or adAccountId was provided.",
          suggestion: "Pass studyId for targeted interpretation or adAccountId to discover readable studies.",
        });
      }

      const interpretedStudies: Record<string, unknown>[] = [];
      for (const study of studiesById.values()) {
        const id = typeof study.id === "string" ? study.id : undefined;
        if (!id) continue;

        const [cellsResult, objectivesResult] = await Promise.all([
          fetchGraph(
            client,
            `ad_study:${id}:cells`,
            graphUrl(client, `/${id}/cells`, { fields: cellFields, limit }),
            warnings,
            "Study cells may require experiment access. Without cells, interpretation is limited to objective payloads.",
          ),
          fetchGraphWithFallback(
            client,
            `ad_study:${id}:objectives`,
            graphUrl(client, `/${id}/objectives`, { fields: objectiveFields, limit }),
            graphUrl(client, `/${id}/objectives`, { fields: objectiveFallbackFields, limit }),
            warnings,
            "Study result payloads can be permission/whitelist dependent; basic objective fields are returned when full results are unavailable.",
          ),
        ]);

        const cells = dataArray(cellsResult);
        const objectives = dataArray(objectivesResult);
        const cellEntities: Record<string, unknown> = {};
        if (includeCellEntities) {
          for (const cell of cells) {
            const cellId = typeof cell.id === "string" ? cell.id : undefined;
            if (!cellId) continue;
            const entities = await fetchGraph(
              client,
              `ad_study_cell:${cellId}:${cellEntityType}`,
              graphUrl(client, `/${cellId}/${cellEntityType}`, {
                fields: "id,name",
                limit,
              }),
              warnings,
              "Cell entity edges vary by study type. Try a different cellEntityType if this edge is unavailable.",
            );
            cellEntities[cellId] = dataArray(entities);
          }
        }

        const interpretedObjectives = objectives.map(interpretStudyObjective);
        interpretedStudies.push({
          ...study,
          inferred_status: inferStudyStatus(study),
          cells,
          objectives: interpretedObjectives,
          cell_entities: includeCellEntities ? cellEntities : undefined,
          interpretation_notes: [
            "Confidence below 90% should not be treated as a winner.",
            "Lift studies estimate incrementality against a holdout; A/B tests compare variants.",
            "If result fields are absent, Meta did not expose the full results payload for this token or study type.",
          ],
        });
      }

      return ok({
        studies: interpretedStudies,
        count: interpretedStudies.length,
        warnings,
      });
    },
  );

  // ── P2. meta_get_organic_content_enrichment ───────────────────────
  server.tool(
    "meta_get_organic_content_enrichment",
    "Read Facebook Page posts and Instagram media with URLs, native periods and optional insights. These are content insights, not Ads Insights; do not infer an organic-only breakdown.",
    {
      pageId: z.string().optional().describe("Facebook Page ID for /posts and linked IG discovery."),
      instagramAccountId: z.string().optional().describe("Instagram professional account ID for /media."),
      postIds: z.array(z.string()).max(50).optional().describe("Specific Facebook post IDs to enrich."),
      mediaIds: z.array(z.string()).max(50).optional().describe("Specific Instagram media IDs to enrich."),
      includePagePosts: z.boolean().optional().default(true),
      includeInstagramMedia: z.boolean().optional().default(true),
      includeInsights: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(100).optional().default(25),
      cursor: cursorSchema,
      since: z.string().optional().describe("Optional Graph time filter. For IG media this should be Unix seconds or strtotime-compatible text."),
      until: z.string().optional().describe("Optional Graph time filter. For IG media this should be Unix seconds or strtotime-compatible text."),
    },
    async ({ pageId, instagramAccountId, postIds, mediaIds, includePagePosts, includeInstagramMedia, includeInsights, limit, cursor, since, until }) => {
      const warnings: MetaWarning[] = [];
      const paging: Record<string, unknown> = {};
      // Fetch metadata independently: an unavailable insight must not hide the post.
      // Likes/comments edges require additional user-content access even with
      // limit(0). Keep the native shares count; do not request those edges.
      const pagePostFields = "id,message,created_time,permalink_url,full_picture,attachments{media,type,url,target,title,description},shares";
      const pagePostFallbackFields = "id,message,created_time,permalink_url,full_picture,shares";
      const igMediaFields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username,like_count,comments_count,children{id,media_type,media_url,thumbnail_url,permalink}";
      const pageClientFor = pageClientResolver(client, warnings);
      const pagePosts: Record<string, unknown>[] = [];
      const instagramMedia: Record<string, unknown>[] = [];
      let resolvedInstagramAccountId = instagramAccountId;

      if (!pageId && !instagramAccountId && (!postIds || postIds.length === 0) && (!mediaIds || mediaIds.length === 0)) {
        warnings.push({
          area: "organic_content",
          message: "No pageId, instagramAccountId, postIds, or mediaIds were provided.",
          suggestion: "Pass pageId for Page posts and linked IG discovery, or instagramAccountId/mediaIds for IG media enrichment.",
        });
      }

      if (includePagePosts && postIds && postIds.length > 0) {
        for (const postId of [...new Set(postIds)]) {
          const ownerId = /^(\d+)_\d+$/.exec(postId)?.[1] ?? pageId;
          if (!ownerId) {
            warnings.push({area: "page_post_ids", message: `Cannot resolve the owning Page for post ${postId}.`, suggestion: "Provide pageId or the full PageID_PostID returned by Meta."});
            continue;
          }
          const pageClient = await pageClientFor(ownerId);
          if (!pageClient) continue;
          const post = await fetchGraphWithFallback(pageClient, "page_post_ids",
            graphUrl(pageClient, `/${encodeURIComponent(postId)}`, {fields: pagePostFields}),
            graphUrl(pageClient, `/${encodeURIComponent(postId)}`, {fields: pagePostFallbackFields}), warnings,
            "Post attachments require Page content access.");
          if (post) pagePosts.push(normalizeOrganicPost(post));
        }
      } else if (includePagePosts && pageId) {
        const pageClient = await pageClientFor(pageId);
        if (pageClient) {
          const result = await fetchGraphWithFallback(pageClient, "page_posts_enrichment",
            graphUrl(pageClient, `/${encodeURIComponent(pageId)}/posts`, {fields: pagePostFields, limit, after: cursor, since, until}),
            graphUrl(pageClient, `/${encodeURIComponent(pageId)}/posts`, {fields: pagePostFallbackFields, limit, after: cursor, since, until}), warnings,
            "Post attachments require pages_read_engagement and Page access.");
          pagePosts.push(...dataArray(result).map(normalizeOrganicPost));
          paging.page_posts = pagingInfo(result);
        }
      }

      if (includeInsights) {
        for (const post of pagePosts) {
          const id = typeof post.id === "string" ? post.id : undefined;
          const ownerId = id ? /^(\d+)_\d+$/.exec(id)?.[1] ?? pageId : undefined;
          if (!id || !ownerId) continue;
          const pageClient = await pageClientFor(ownerId);
          if (!pageClient) continue;
          post.insights = await fetchGraph(pageClient, `page_post:${id}:insights`,
            graphUrl(pageClient, `/${encodeURIComponent(id)}/insights`, {metric: "post_media_view,post_clicks"}), warnings,
            "Page post insights require read_insights and a Page token. Unavailable metrics are not zero; post metadata is retained.");
        }
      }

      if (includeInstagramMedia && !resolvedInstagramAccountId && pageId) {
        const page = await fetchGraph(
          client,
          "page_linked_instagram_for_media",
          graphUrl(client, `/${pageId}`, {
            fields: "id,name,instagram_business_account{id,username,name},connected_instagram_account{id,username,name}",
          }),
          warnings,
          "Grant pages_show_list/pages_read_engagement plus instagram_basic to discover linked Instagram accounts from the Page.",
        );
        const businessAccount = isRecord(page?.instagram_business_account) ? page.instagram_business_account : undefined;
        const connectedAccount = isRecord(page?.connected_instagram_account) ? page.connected_instagram_account : undefined;
        resolvedInstagramAccountId = typeof businessAccount?.id === "string"
          ? businessAccount.id
          : typeof connectedAccount?.id === "string"
            ? connectedAccount.id
            : undefined;
      }

      if (includeInstagramMedia && mediaIds && mediaIds.length > 0) {
        const result = await fetchGraph(
          client,
          "instagram_media_ids",
          graphUrl(client, "", { ids: mediaIds.join(","), fields: igMediaFields }),
          warnings,
          "Verify the IG media IDs are readable and the token has instagram_basic plus Page access.",
        );
        instagramMedia.push(...Object.values(result ?? {}).filter(isRecord).map(normalizeInstagramMedia));
      } else if (includeInstagramMedia && resolvedInstagramAccountId) {
        const result = await fetchGraph(
          client,
          "instagram_media",
          graphUrl(client, `/${resolvedInstagramAccountId}/media`, {
            fields: igMediaFields,
            limit,
            after: cursor,
            since,
            until,
          }),
          warnings,
          "IG media reads require instagram_basic and Page access. Story media uses a separate stories endpoint and is not fetched here.",
        );
        instagramMedia.push(...dataArray(result).map(normalizeInstagramMedia));
        paging.instagram_media = pagingInfo(result);
      }

      if (includeInsights && instagramMedia.length > 0) {
        for (const media of instagramMedia) {
          const mediaId = typeof media.id === "string" ? media.id : undefined;
          if (!mediaId) continue;
          const metrics = instagramInsightMetrics(media);
          media.insights_requested_metrics = metrics;
          try {
            media.insights = await client.fetchUrl(graphUrl(client, `/${encodeURIComponent(mediaId)}/insights`, {metric: metrics.join(",")}));
          } catch (error) {
            warnings.push(warningFromError(`instagram_media:${mediaId}:insights`, error,
              "Insight availability depends on media format, age and permissions. Unavailable metrics are not zero; media metadata is retained."));
            // One bounded fallback for metric incompatibility only. Do not retry
            // authentication, permission, rate-limit or unavailable-media failures.
            const incompatible = error instanceof MetaApiException && error.code === 100
              && /metric.*(incompat|valid|supported|must be)|invalid.*metric/i.test(error.message);
            media.insights = incompatible && metrics.length > 1
              ? await fetchGraph(client, `instagram_media:${mediaId}:reach`,
                  graphUrl(client, `/${encodeURIComponent(mediaId)}/insights`, {metric: "reach"}), warnings,
                  "Only reach was retried after Meta rejected the format-specific metric selection; other metrics remain unavailable.")
              : null;
          }
          media.insights_returned_metrics = dataArray(isRecord(media.insights) ? media.insights : null).map(row => row.name);

        }
      }

      const insightState=(item:Record<string,unknown>,requested:string[])=>{
        const result=isRecord(item.insights)?item.insights:null;
        const returned=dataArray(result);
        return {requested:includeInsights,source:"content_insights",delivery_breakdown:"not_established",metrics:Object.fromEntries(requested.map(name=>{
          const metric=returned.find(m=>m.name===name);
          return [name,{status:!includeInsights?"not_requested":!result?"read_failed":!metric?"not_returned":"returned",period:metric?.period??null}];
        }))};
      };
      for(const post of pagePosts)post.insight_coverage=insightState(post,["post_media_view","post_clicks"]);
      for(const media of instagramMedia)media.insight_coverage=insightState(media,Array.isArray(media.insights_requested_metrics)?media.insights_requested_metrics:instagramInsightMetrics(media));

      return ok({
        page_id: pageId,
        instagram_account_id: resolvedInstagramAccountId,
        page_posts: pagePosts,
        instagram_media: instagramMedia,
        counts: {
          page_posts: pagePosts.length,
          instagram_media: instagramMedia.length,
        },
        notes: [
          "Facebook likes/comments edges are not requested. Missing engagement counts are unavailable, not zero; no commenter profiles are collected.",
          "Media insights retain Meta’s native periods (usually lifetime). since/until filter the media list, not the measurement period of each media insight.",
          "Instagram thumbnail_url is media-type dependent and may only appear for video/Reels media.",
          "This tool reads existing Page/Instagram content; it never publishes, edits, hides, or deletes posts.",
          "Content insights are not Ads Insights. Do not label a metric organic-only unless Meta supplies an explicit organic breakdown or definition.",
          "Preserve native metric names, titles, descriptions and periods. Unusual titles alone do not establish audience restrictions.",
          "Native Reel watch time is in milliseconds; do not add an unverified per-view denominator, infer duration from CDN URLs, or infer completion rates or causes of counter discrepancies.",
          "Keep full returned media URLs as clickable link targets; do not strip required signed query parameters. A media URL is different from a post permalink or an ad landing page.",
        ],
        paging,
        warnings,
      });
    },
  );

  // ── 1. meta_list_ad_accounts ──────────────────────────────────────
  server.tool(
    "meta_list_ad_accounts",
    "List all Meta ad accounts accessible with the current token. Returns account ID, name, currency, timezone, and status.",
    {},
    async () => {
      try {
        const accounts = await client.getAdAccounts();
        return ok({ accounts, count: accounts.length });
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 2. meta_get_account_details ───────────────────────────────────
  server.tool(
    "meta_get_account_details",
    "Get detailed information for a specific Meta ad account: name, currency, timezone, spend cap, status, business info.",
    { adAccountId: adAccountIdSchema },
    async ({ adAccountId }) => {
      try {
        const account = await client.getAdAccount(adAccountId);
        return ok(account);
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 3. meta_get_campaigns ─────────────────────────────────────────
  server.tool(
    "meta_get_campaigns",
    "List campaigns for a Meta ad account. Returns campaign ID, name, status, objective, budget, and bid strategy.",
    {
      adAccountId: adAccountIdSchema,
      statusFilter: statusFilterSchema,
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, statusFilter, limit = 100, cursor }) => {
      try {
        const fields = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,bid_strategy,buying_type,start_time,stop_time";
        let url = `https://graph.facebook.com/${client.apiVersion}/${adAccountId}/campaigns?fields=${fields}&limit=${limit}`;
        if (statusFilter) url += `&filtering=[{"field":"effective_status","operator":"IN","value":["${statusFilter}"]}]`;
        if (cursor) url += `&after=${cursor}`;
        const result = await client.fetchUrl(url);
        return ok(entityListResult(result, statusFilter));
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 4. meta_get_adsets ────────────────────────────────────────────
  server.tool(
    "meta_get_adsets",
    "List ad sets for a Meta ad account, optionally filtered by campaign. Returns targeting, budget, optimization, and schedule info.",
    {
      adAccountId: adAccountIdSchema,
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      statusFilter: statusFilterSchema,
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, campaignId, statusFilter, limit = 100, cursor }) => {
      try {
        const fields = "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_amount,targeting,start_time,end_time";
        const parent = campaignId ?? adAccountId;
        let url = `https://graph.facebook.com/${client.apiVersion}/${parent}/adsets?fields=${fields}&limit=${limit}`;
        if (statusFilter) url += `&filtering=[{"field":"effective_status","operator":"IN","value":["${statusFilter}"]}]`;
        if (cursor) url += `&after=${cursor}`;
        const result = await client.fetchUrl(url);
        return ok(entityListResult(result, statusFilter));
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 5. meta_get_ads ───────────────────────────────────────────────
  server.tool(
    "meta_get_ads",
    "List ads for a Meta ad account, optionally filtered by ad set. Returns ad ID, name, status, and creative reference.",
    {
      adAccountId: adAccountIdSchema,
      adsetId: z.string().optional().describe("Filter by ad set ID; adSetId is also accepted."),
      adSetId: z.string().optional().describe("Alias for adsetId. If both are supplied, they must match."),
      statusFilter: statusFilterSchema,
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, adsetId, adSetId, statusFilter, limit = 100, cursor }) => {
      try {
        if (adsetId && adSetId && adsetId !== adSetId) throw new Error("adsetId and adSetId must match when both are supplied.");
        const fields = "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,thumbnail_url,object_story_spec,asset_feed_spec}";
        const parent = adsetId ?? adSetId ?? adAccountId;
        let url = `https://graph.facebook.com/${client.apiVersion}/${parent}/ads?fields=${fields}&limit=${limit}`;
        if (statusFilter) url += `&filtering=[{"field":"effective_status","operator":"IN","value":["${statusFilter}"]}]`;
        if (cursor) url += `&after=${cursor}`;
        const result = await client.fetchUrl(url);
        return ok(entityListResult(result, statusFilter));
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 6. meta_get_insights ──────────────────────────────────────────
  server.tool(
    "meta_get_insights",
    `Query Meta Ads performance insights. Supports 170+ metrics, 43+ breakdowns with intelligent query planning.
Use meta://metrics resource to see available metrics. Use meta://breakdowns for available breakdowns.
The query planner automatically splits incompatible metric/breakdown combinations into multiple API requests and merges results.
For purchases, leads or conversion analysis, request actions (and action_values for revenue) or explicit metrics such as purchases, omni_purchases or leads. The native conversions field is not a universal conversion total, and its absence does not mean purchases or leads are unavailable. Label the exact action_type and never sum overlapping purchase types.`,
    {
      adAccountId: adAccountIdSchema,
      level: levelSchema.describe("Aggregation level: account, campaign, adset, or ad"),
      metrics: z.array(z.string()).min(1).describe("Metric keys from meta://metrics (e.g., impressions, spend, ctr)"),
      dimensions: z.array(z.string()).max(100).optional().describe("Dimension keys listed in meta://compatibility. Entity metadata, such as names, statuses and budgets, is read at its current value."),
      adsetIds: z.array(z.string().regex(/^\d+$/)).min(1).max(100).optional().describe("Restrict adset- or ad-level insights to these ad set IDs."),
      effectiveStatus: z.enum(["ACTIVE", "PAUSED"]).optional().describe("Keep only entities with this native effective status at the selected level."),
      breakdowns: z.array(z.string()).optional().describe("Breakdown keys from meta://breakdowns (e.g., age, gender, country)"),
      actionBreakdowns: z.array(z.string()).optional().describe("Native action breakdowns such as action_type. Only for action metrics."),
      datePreset: datePresetSchema.describe("Predefined date range (e.g., last_7d, last_30d)"),
      timeRange: timeRangeSchema.describe("Custom date range with since/until in YYYY-MM-DD format"),
      timeIncrement: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(28), z.literal(30), z.string()]).optional().describe("Time granularity: 1 (daily), 7 (weekly), 'monthly', or 'all_days'"),
      adIds: z.array(z.string().regex(/^\d+$/)).min(1).max(100).optional().describe("Restrict ad-level insights to these ad IDs."),
      campaignIds: z.array(z.string().regex(/^\d+$/)).min(1).max(100).optional().describe("Restrict campaign-, adset- or ad-level insights to these campaign IDs."),
      attributionMode: z.enum(["account", "adset", "explicit"]).default("account").describe("Use Meta account settings, ad-set settings, or explicitly supplied windows. No setting is inferred from returned numbers."),
      attributionWindows: z.array(z.enum(["1d_click", "7d_click", "28d_click", "1d_view", "1d_ev"])).min(1).max(5).optional().describe("Only with attributionMode explicit. These windows are sent identically to every split query and account total."),
      actionReportTime: z.enum(["impression", "conversion", "mixed"]).default("impression").describe("Date basis for actions, sent explicitly to Meta."),
      includeAccountTotals: z.boolean().default(false).describe("Also read native account-level totals with the same dates, metrics and attribution. Requires no entity filter, dimension or breakdown."),
      limit: z.number().int().min(1).max(5000).optional().default(500),
    },
    async ({ adAccountId, level, metrics, dimensions = [], breakdowns, actionBreakdowns, datePreset, timeRange, timeIncrement, adIds, adsetIds, campaignIds, effectiveStatus, limit, attributionMode = "account", attributionWindows, actionReportTime = "impression", includeAccountTotals = false }) => {
      try {
        const startTime = Date.now();

        // Plan the query
        if (adIds && level !== "ad") throw new Error("adIds requires level ad.");
        if (campaignIds && (level === "account" || includeAccountTotals)) throw new Error("campaignIds requires an entity level without account totals.");
        if (adsetIds && !["adset", "ad"].includes(level)) throw new Error("adsetIds requires adset or ad level.");
        if (effectiveStatus && level === "account") throw new Error("effectiveStatus requires an entity level.");
        // Native conversions is not a universal total: include the event arrays
        // needed to distinguish absent fields from available purchases/leads.
        const requestedMetrics = [...metrics];
        const supportingMetrics = [
          ...(metrics.includes("conversions") && !metrics.includes("actions") ? ["actions"] : []),
          ...(metrics.includes("conversion_values") && !metrics.includes("action_values") ? ["action_values"] : []),
        ];
        metrics = [...metrics, ...supportingMetrics];
        const insightDimensions = insightDimensionKeys(dimensions, level);
        const plan = planQueries({
          adAccountId,
          level,
          metrics,
          dimensions: insightDimensions,
          actionBreakdowns,
          breakdowns: breakdowns ?? [],
          datePreset: (datePreset ?? "last_30d") as import("./types.js").DatePreset,
          timeRange,
          timeIncrement: timeIncrement as import("./types.js").TimeIncrement | undefined,
          limit,
        });

        if (plan.errors.length > 0) {
          return ok({
            error: "Query validation failed",
            errors: plan.errors,
            warnings: plan.warnings,
            suggestion: "Check meta://compatibility for valid metric/breakdown combinations",
          });
        }

        if (includeAccountTotals && (adIds?.length || adsetIds?.length || effectiveStatus || dimensions.length || breakdowns?.length || actionBreakdowns?.length)) throw new Error("Native account totals require no entity filter, dimension or breakdown; run a separate account-level query instead.");
        const measurement = {attributionMode, attributionWindows: attributionWindows ? [...new Set(attributionWindows)] : undefined, actionReportTime};
        const sentMeasurement = measurementParams({...plan.requests[0], ...measurement});
        for(const request of plan.requests) Object.assign(request, measurement);
        // Execute all requests
        const allResults: Record<string, unknown>[][] = [];
        for (const request of plan.requests) {
          const filtering = [
            ...(adIds ? [{field:"ad.id",operator:"IN",value:adIds}] : []),
            ...(adsetIds ? [{field:"adset.id",operator:"IN",value:adsetIds}] : []),
            ...(campaignIds ? [{field:"campaign.id",operator:"IN",value:campaignIds}] : []),
            ...(effectiveStatus ? [{field:`${level}.effective_status`,operator:"IN",value:[effectiveStatus]}] : []),
          ];
          const result = await client.fetchInsights(adAccountId, {...request, ...(filtering.length ? {filtering} : {})});
          allResults.push(result);
        }

        // Merge results
        let data = mergeResults(allResults, plan.joinKeys);

        // Calculate derived metrics
        if (plan.calculatedMetrics.length > 0) {
          data = data.map((row) => ({
            ...row,
            ...calculateDerivedMetrics(row as import("./types.js").InsightRow),
          }));
        }

        if (metrics.some(key => key === "spendShare" || key === "purchaseValueShare")) {
          if (breakdowns?.length || actionBreakdowns?.length) throw new Error("Share metrics require an unsegmented report to avoid double-counting totals.");
          data = calculateShareMetrics(data as import("./types.js").InsightRow[]);
        }

        data = await enrichMetaDimensions(data, dimensions, level, formatAdAccountId(adAccountId), (path,params) => client.fetchUrl(graphUrl(client,path,params)));
        let accountTotals: Record<string, unknown>[] | null = null;
        let totalsRequestCount = 0;
        if(includeAccountTotals) {
          if(level === "account") accountTotals = data;
          else {
            const totalsPlan = planQueries({adAccountId,level:"account",metrics,breakdowns:[],datePreset:(datePreset??"last_30d") as import("./types.js").DatePreset,timeRange,timeIncrement:timeIncrement as import("./types.js").TimeIncrement|undefined,limit});
            if(totalsPlan.errors.length) throw new Error("Cannot produce comparable native account totals: " + totalsPlan.errors.join("; "));
            const results:Record<string,unknown>[][]=[];
            for(const q of totalsPlan.requests){results.push(await client.fetchInsights(adAccountId,{...q,...measurement}));totalsRequestCount++;}
            accountTotals=mergeResults(results,totalsPlan.joinKeys);
            if(totalsPlan.calculatedMetrics.length)accountTotals=accountTotals.map(row=>({...row,...calculateDerivedMetrics(row as import("./types.js").InsightRow)}));
          }
        }
        const evidence=reportingEvidence(allResults,plan.requests,plan.joinKeys,data);
        return ok({
          data,
          metric_selection: {requested: requestedMetrics, supporting_metrics_added: supportingMetrics},
          reporting_context: {ad_account_id:adAccountId,level,time_range:timeRange??null,date_preset:timeRange?null:(datePreset??"last_30d"),time_increment:timeIncrement??"all_days",attribution:{mode:attributionMode,requested_windows:attributionWindows??null,resolved_native_windows:null,parameters_sent:sentMeasurement},action_report_time:actionReportTime,ad_ids:adIds??null,breakdowns:breakdowns??[],pagination_exhausted:true},
          account_totals: accountTotals,
          evidence,
          notes: evidence.notes,
          rowCount: data.length,
          debug: {
            requestCount: plan.requests.length + totalsRequestCount,
            executionTimeMs: Date.now() - startTime,
            warnings: plan.warnings,
            calculatedMetrics: plan.calculatedMetrics,
          },
        });
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 7. meta_get_campaign_structure ────────────────────────────────
  server.tool(
    "meta_get_campaign_structure",
    "Get hierarchical campaign structure: campaigns -> ad sets -> ads. Useful for understanding account organization.",
    {
      adAccountId: adAccountIdSchema,
      campaignId: z.string().optional().describe("Get structure for a specific campaign only"),
    },
    async ({ adAccountId, campaignId }) => {
      try {
        const campaignFields = "id,name,status,effective_status,objective";
        const adsetFields = "id,name,status,effective_status,campaign_id,optimization_goal";
        const adFields = "id,name,status,effective_status,adset_id,campaign_id";

        const parent = campaignId ?? adAccountId;

        if (campaignId) {
          const [adsets, ads] = await Promise.all([
            client.fetchUrl(`https://graph.facebook.com/${client.apiVersion}/${campaignId}/adsets?fields=${adsetFields}&limit=100`),
            client.fetchUrl(`https://graph.facebook.com/${client.apiVersion}/${campaignId}/ads?fields=${adFields}&limit=100`),
          ]);
          const campaign = await client.fetchUrl(`https://graph.facebook.com/${client.apiVersion}/${campaignId}?fields=${campaignFields}`);
          return ok({ campaign, adsets: adsets.data, ads: ads.data });
        }

        const campaigns = await client.fetchUrl(
          `https://graph.facebook.com/${client.apiVersion}/${parent}/campaigns?fields=${campaignFields}&limit=50`,
        );
        const campaignList = campaigns.data as unknown[] ?? [];
        return ok({ campaigns: campaignList, totalCampaigns: campaignList.length });
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 8. meta_get_creatives ─────────────────────────────────────────
  server.tool(
    "meta_get_creatives",
    "Get ad creative content: text, images, videos, links, call-to-action. Returns creative details for specified ads.",
    {
      adAccountId: adAccountIdSchema,
      adIds: z.array(z.string()).optional().describe("Specific ad IDs to get creatives for"),
      limit: limitSchema,
    },
    async ({ adAccountId, adIds, limit }) => {
      try {
        const fields = "id,name,status,creative{id,name,body,title,image_url,image_hash,video_id,thumbnail_url,link_url,object_story_spec,asset_feed_spec,call_to_action_type}";
        if (adIds && adIds.length > 0) {
          const ids = [...new Set(adIds)];
          if (ids.length > 500 || ids.some(id => !/^\d+$/.test(id))) {
            throw new Error("Provide at most 500 numeric ad IDs.");
          }
          const account = formatAdAccountId(adAccountId);
          const merged: Record<string, unknown> = {};
          const warnings: MetaWarning[] = [];
          let requestCount = 0;
          // Graph v26 removed the root ?ids= multi-node lookup. Query the
          // authorized account instead, retaining the legacy ID-keyed result.
          for (let index = 0; index < ids.length; index += 50) {
            const chunk = ids.slice(index, index + 50);
            const result = await client.fetchUrl(graphUrl(client, `/${account}/ads`, {
              fields: `account_id,${fields}`,
              filtering: JSON.stringify([{field: "id", operator: "IN", value: chunk}]),
              limit: 500,
            }));
            requestCount++;
            for (const ad of dataArray(result)) {
              if (typeof ad.id === "string" && chunk.includes(ad.id)
                && typeof ad.account_id === "string" && formatAdAccountId(ad.account_id) === account) {
                merged[ad.id] = ad;
              }
            }
          }
          // Historical ads may be missing from the account inventory. Bound
          // exact-node reads and verify ownership before returning their data.
          const missing = ids.filter(id => !merged[id]);
          for (const id of missing.slice(0, 10)) {
            requestCount++;
            const ad = await fetchGraph(client, "historical_ad_creative",
              graphUrl(client, `/${id}`, {fields: `account_id,${fields}`}), warnings,
              "Verify that this historical ad is still accessible in the selected account.");
            if (ad?.id === id && typeof ad.account_id === "string"
              && formatAdAccountId(ad.account_id) === account) merged[id] = ad;
          }
          const unresolved = ids.filter(id => !merged[id]);
          if (unresolved.length) warnings.push({area: "creative_lookup",
            message: `${unresolved.length} requested ads could not be verified in the selected account.`,
            suggestion: "Narrow the selection; historical fallback is limited to 10 ads. Missing ads are not empty creatives."});
          return ok({...merged, warnings, debug: {requestCount}});
        }
        const result = await client.fetchUrl(graphUrl(client, `/${formatAdAccountId(adAccountId)}/ads`, {fields, limit}));
        return ok(result);
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 9. meta_get_audiences ─────────────────────────────────────────
  server.tool(
    "meta_get_audiences",
    "List custom, saved, and lookalike audiences for a Meta ad account.",
    {
      adAccountId: adAccountIdSchema,
      type: z.enum(["custom", "saved", "lookalike"]).optional().describe("Filter by audience type"),
      limit: limitSchema,
    },
    async ({ adAccountId, type, limit }) => {
      try {
        const endpoint = type === "saved" ? "saved_audiences" : "customaudiences";
        const fields = type === "saved"
          ? "id,name,targeting,description"
          : "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,description,time_created";
        let url = `https://graph.facebook.com/${client.apiVersion}/${adAccountId}/${endpoint}?fields=${fields}&limit=${limit}`;
        if (type === "lookalike") {
          url += `&filtering=[{"field":"subtype","operator":"EQUAL","value":"LOOKALIKE"}]`;
        }
        const result = await client.fetchUrl(url);
        return ok(result);
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 10. meta_get_ad_studies ────────────────────────────────────────
  server.tool(
    "meta_get_ad_studies",
    "List conversion lift studies and A/B tests (Ad Studies) for an ad account. Includes study type, status, and cells.",
    { adAccountId: adAccountIdSchema },
    async ({ adAccountId }) => {
      try {
        const studies = await client.getAdStudies(adAccountId);
        return ok({ studies, count: studies.length });
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 11. meta_get_study_results ────────────────────────────────────
  server.tool(
    "meta_get_study_results",
    "Get detailed results for a conversion lift or A/B test study. Returns objectives, cells, and lift results.",
    { studyId: z.string().describe("The Ad Study ID") },
    async ({ studyId }) => {
      try {
        const [cells, objectives] = await Promise.all([
          client.getAdStudyCells(studyId),
          client.getAdStudyObjectives(studyId).catch(() => client.getAdStudyObjectivesBasic(studyId)),
        ]);
        return ok({ studyId, cells, objectives });
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 12. meta_validate_query ───────────────────────────────────────
  server.tool(
    "meta_validate_query",
    "Validate a metric/breakdown combination BEFORE executing. Returns errors and warnings. Use this to check if your query will work.",
    {
      metrics: z.array(z.string()).min(1).describe("Metric keys to validate"),
      breakdowns: z.array(z.string()).optional().describe("Breakdown keys to validate"),
      level: levelSchema.optional().describe("Aggregation level"),
    },
    async ({ metrics, breakdowns, level }) => {
      try {
        const result = validateQuerySelection(metrics, breakdowns ?? [], [], level ?? "campaign");
        return ok(result);
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  // ── 13. meta_get_page_posts ───────────────────────────────────────
  server.tool(
    "meta_get_page_posts",
    "Read published Facebook Page posts using a Page token resolved from the connected user. Returns exact PageID_PostID, message, permalink and media attachments. Use postId for an exact existing-post ad preflight. No Instagram media, comments, likes or insights are requested; this read alone does not establish advertising eligibility.",
    {
      pageId: z.string().regex(/^\d+$/).describe("Facebook Page ID"),
      postId: z.string().regex(/^\d+_\d+$/).optional().describe("Exact PageID_PostID to read instead of the recent-post list; must belong to pageId."),
      limit: z.number().int().min(1).max(100).optional().default(25),
      cursor: cursorSchema,
    },
    async ({ pageId, postId, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      if (postId && (!postId.startsWith(`${pageId}_`) || cursor)) {
        return { ...ok({error: "postId must belong to pageId and cannot be combined with a list cursor."}), isError: true };
      }
      const pageClient = await pageClientResolver(client, warnings)(pageId);
      if (!pageClient) return { ...ok({error: "Could not obtain access to the selected Page. No posts were read.", warnings}), isError: true };
      const path = postId ? `/${encodeURIComponent(postId)}` : `/${encodeURIComponent(pageId)}/posts`;
      const params = postId ? {} : {limit, after: cursor};
      const result = await fetchGraphWithFallback(pageClient, "page_posts",
        graphUrl(pageClient, path, {...params, fields: "id,message,created_time,permalink_url,full_picture,attachments{media,type,url,target,title,description},shares"}),
        graphUrl(pageClient, path, {...params, fields: "id,message,created_time,permalink_url,full_picture,shares"}), warnings,
        "Post attachments require pages_read_engagement and access to this Page.");
      if (!result) return { ...ok({error: "Could not read the selected Page posts.", warnings}), isError: true };
      return ok({ ...(postId ? {data: [result]} : result), page_id: pageId,
        coverage: {scope: postId ? "exact_post" : "page_posts", has_more: !!(isRecord(result.paging) && result.paging.next)},
        warnings,
        notes: ["Use the native PageID_PostID to reuse a post; the number in a Reel permalink is not its post ID.", "Advertising eligibility requires separate creative/ad validation by Meta. Missing engagement counts are unavailable, not zero."],
      });
    },
  );

  // ── 14. meta_debug_token ──────────────────────────────────────────
  server.tool(
    "meta_debug_token",
    "Inspect token identity, validity, expiry and scopes. When Meta refuses to inspect this token with itself, independently check the connecting user and granted permissions; token and app metadata then remain unknown.",
    {},
    async () => {
      try {
        const info = await client.debugToken();
        return ok(info);
      } catch (e) {
        const warnings = [warningFromError("token", e,
          "Token metadata inspection is unavailable. This does not prove token expiry or missing permissions.")];
        let identity: { id: string; name?: string } | null = null;
        let scopes: string[] | null = null;
        try { identity = await client.getCurrentUserIdentity(); }
        catch (error) { warnings.push(warningFromError("identity", error, "Connecting user identity is unverified.")); }
        try { scopes = await client.getGrantedPermissions(); }
        catch (error) { warnings.push(warningFromError("scopes", error, "Granted permissions remain unknown.")); }
        return ok({
          status: identity || scopes !== null ? "partial" : "unavailable",
          is_valid: null, app_id: null, expires_at: null,
          user_id: identity?.id ?? null, user_name: identity?.name ?? null,
          scopes, permissionSource: scopes === null ? null : "me_permissions",
          appAccessLevel: "not_checked", accountSecurityCheckpoint: "not_checked",
          warnings,
        });
      }
    },
  );

  // ── 15. meta_search_entities ──────────────────────────────────────
  server.tool(
    "meta_search_entities",
    "Search campaigns, ad sets, or ads by name within an ad account. Useful for finding specific entities.",
    {
      adAccountId: adAccountIdSchema,
      entityType: z.enum(["campaigns", "adsets", "ads"]).describe("Type of entity to search"),
      nameFilter: z.string().describe("Name substring to search for"),
      statusFilter: statusFilterSchema,
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, entityType, nameFilter, statusFilter, limit, cursor }) => {
      try {
        const fieldsMap = {
          campaigns: "id,name,status,effective_status,objective",
          adsets: "id,name,status,effective_status,campaign_id,optimization_goal",
          ads: "id,name,status,effective_status,adset_id,campaign_id",
        };
        const fields = fieldsMap[entityType];
        const filters: Array<{field: string; operator: string; value: string | string[]}> = [{ field: "name", operator: "CONTAIN", value: nameFilter }];
        if (statusFilter) filters.push({ field: "effective_status", operator: "IN", value: [statusFilter] });
        const url = graphUrl(client, `/${formatAdAccountId(adAccountId)}/${entityType}`, {
          fields, limit, filtering: JSON.stringify(filters), after: cursor,
        });
        const result = await client.fetchUrl(url);
        return ok(entityListResult(result, statusFilter));
      } catch (e) {
        return formatMcpToolError(e);
      }
    },
  );

  registerMetaBroadReadTools(server, client, ok);
  // ── 16. meta_list_ad_images ───────────────────────────────────────
  server.tool(
    "meta_list_ad_images",
    "List the ad account image library (/adimages): hash, name, dimensions, status, a permanent publicly served display URL (permalink_url), short-lived CDN URLs, and optionally the creatives using each image.",
    {
      adAccountId: adAccountIdSchema,
      nameFilter: z.string().optional().describe("Only images whose file name matches this value"),
      hashes: z.array(z.string()).optional().describe("Only these image hashes (exact match)"),
      minWidth: z.number().int().min(1).optional().describe("Only images at least this wide, in pixels"),
      minHeight: z.number().int().min(1).optional().describe("Only images at least this tall, in pixels"),
      includeUsage: z.boolean().optional().default(false).describe("Also return the creative IDs using each image"),
      limit: limitSchema,
      cursor: cursorSchema,
    },
    async ({ adAccountId, nameFilter, hashes, minWidth, minHeight, includeUsage, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const baseFields = [
        "id", "hash", "name", "status", "created_time", "updated_time",
        "original_width", "original_height", "width", "height",
        "permalink_url", "url", "url_128",
      ];
      if (includeUsage) baseFields.push("creatives");

      const result = await fetchGraph(
        client,
        "ad_images",
        graphUrl(client, `/${formatAdAccountId(adAccountId)}/adimages`, {
          fields: baseFields.join(","),
          limit: typeof limit === "number" ? limit : 100,
          after: cursor,
          summary: "total_count",
          name: nameFilter,
          hashes: Array.isArray(hashes) && hashes.length > 0 ? JSON.stringify(hashes) : undefined,
          minwidth: minWidth,
          minheight: minHeight,
        }),
        warnings,
        "Verify the token has ads_read on this ad account.",
      );

      const images = dataArray(result).map((image) => ({
        ...image,
        creatives: Array.isArray(image.creatives) ? image.creatives : undefined,
      }));
      const summary = isRecord(result?.summary) ? result.summary : undefined;

      return ok({
        images,
        count: images.length,
        totalCount: typeof summary?.total_count === "number" ? summary.total_count : undefined,
        paging: pagingInfo(result),
        warnings,
        limitations: [
          "Use url (or url_128 for a small preview) for image bytes. permalink_url can return Facebook HTML and is not an image file.",
          "CDN URLs are signed and can expire. Re-list by hash to refresh; do not store the URLs as durable links.",
        ],
        nextActions: pagingInfo(result)
          ? ["Pass the paging cursor as `cursor` to fetch the next page."]
          : [],
      });
    },
  );

  // ── 17. meta_list_ad_videos ───────────────────────────────────────
  server.tool(
    "meta_list_ad_videos",
    "List the ad account video library (/advideos): title, duration, processing status, and publicly served thumbnails (preferred and largest sizes). Source file URLs are returned only on request because they expire quickly.",
    {
      adAccountId: adAccountIdSchema,
      titleFilter: z.string().optional().describe("Only videos whose title contains this value"),
      minLengthSeconds: z.number().min(0).optional().describe("Only videos at least this many seconds long"),
      maxLengthSeconds: z.number().min(1).optional().describe("Only videos at most this many seconds long"),
      includeSource: z.boolean().optional().default(false).describe("Also return the short-lived raw video file URL for each video"),
      limit: z.number().int().min(1).max(200).optional().default(25).describe("Videos per page (thumbnail payloads are heavy, keep this modest)"),
      cursor: cursorSchema,
    },
    async ({ adAccountId, titleFilter, minLengthSeconds, maxLengthSeconds, includeSource, limit, cursor }) => {
      const warnings: MetaWarning[] = [];
      const baseFields = [
        "id", "title", "status", "created_time", "updated_time", "length",
        "picture", "permalink_url",
        "thumbnails{uri,width,height,scale,is_preferred}",
      ];
      if (includeSource) baseFields.push("source");

      const result = await fetchGraph(
        client,
        "ad_videos",
        graphUrl(client, `/${formatAdAccountId(adAccountId)}/advideos`, {
          fields: baseFields.join(","),
          limit: typeof limit === "number" ? limit : 25,
          after: cursor,
          summary: "total_count",
          title: titleFilter,
          // Vérifié en live (Graph v26.0) : minlength/maxlength s'expriment en
          // millisecondes malgré une doc muette; en secondes, maxlength=120
          // élimine silencieusement toutes les vidéos.
          minlength: typeof minLengthSeconds === "number" ? Math.floor(minLengthSeconds * 1000) : undefined,
          maxlength: typeof maxLengthSeconds === "number" ? Math.ceil(maxLengthSeconds * 1000) : undefined,
        }),
        warnings,
        "Verify the token has ads_read on this ad account.",
      );

      const videos = dataArray(result).map((video) => normalizeAdVideo(video, Boolean(includeSource)));
      const summary = isRecord(result?.summary) ? result.summary : undefined;

      return ok({
        videos,
        count: videos.length,
        totalCount: typeof summary?.total_count === "number" ? summary.total_count : undefined,
        paging: pagingInfo(result),
        warnings,
        limitations: [
          "Thumbnail and picture URLs are publicly served without authentication but carry CDN signatures that expire after a few weeks: re-list to refresh, do not store them as durable links.",
          "permalink_url points at facebook.com/watch and requires a logged-in session: unsuitable for hotlinking.",
          includeSource
            ? "source URLs are short-lived signed download links: use them immediately."
            : "Call meta_get_video_sources with specific video IDs when you need downloadable source file URLs.",
        ],
        nextActions: pagingInfo(result)
          ? ["Pass the paging cursor as `cursor` to fetch the next page."]
          : [],
      });
    },
  );

  // ── 18. meta_get_video_sources ────────────────────────────────────
  server.tool(
    "meta_get_video_sources",
    "Resolve fresh download URLs (source) and thumbnails for specific ad videos. Call this at download time: the returned URLs are signed and expire quickly.",
    {
      adAccountId: adAccountIdSchema.describe("Ad account that owns the videos, used for scoping and rate limits"),
      videoIds: z.array(z.string()).min(1).max(10).describe("Video IDs to resolve (at most 10 per call, one Graph request each)"),
      pageId: z.string().regex(/^\d+$/).optional().describe("Owning Page ID from the ad creative. Allows Page-token fallback even when the user token cannot read the video node."),
    },
    async ({ adAccountId, videoIds, pageId: owningPageId }) => {
      void adAccountId;
      const warnings: MetaWarning[] = [];
      // Le paramètre batch `?ids=` est déprécié depuis Graph v26.0 (code 100) :
      // chaque vidéo se lit sur son propre nœud, d'où le plafond de 10 par appel
      // (le Worker est limité à 50 sous-requêtes par invocation).
      const maxIdsPerCall = 10;
      const requested = Array.isArray(videoIds) ? [...new Set(videoIds.map(String).filter(Boolean))] : [];
      const ids = requested.slice(0, maxIdsPerCall);
      if (ids.length === 0) {
        return ok({
          videos: [],
          count: 0,
          warnings: [{
            area: "video_sources",
            message: "No video IDs were provided.",
            suggestion: "Pass videoIds from meta_list_ad_videos.",
          }],
        });
      }
      if (requested.length > maxIdsPerCall) {
        warnings.push({
          area: "video_sources",
          message: `Only the first ${maxIdsPerCall} of ${requested.length} video IDs were resolved.`,
          suggestion: "Call again with the remaining IDs: each video costs one Graph request.",
        });
      }

      const videoFields = "id,title,status,length,source,picture,permalink_url,from,thumbnails{uri,width,height,is_preferred}";
      const fetched: Record<string, unknown>[] = [];
      for (const videoId of ids) {
        const result = await fetchGraph(
          client,
          `video_${videoId}`,
          graphUrl(client, `/${encodeURIComponent(videoId)}`, { fields: videoFields }),
          warnings,
          "Verify the video ID comes from meta_list_ad_videos and is readable by this token.",
        );
        if (result) fetched.push(result);
        else if (owningPageId) fetched.push({id:videoId});
      }

      // Vérifié en live : une vidéo hébergée par une Page (post boosté…) ne
      // livre pas `source` au token du compte, mais le token de la Page :
      // dérivable du même token quand il administre la Page; le livre.
      const pageClients = new Map<string, MetaClient | null>();
      for (const video of fetched) {
        if (typeof video.source === "string") continue;
        const from = isRecord(video.from) ? video.from : undefined;
        const pageId = typeof from?.id === "string" ? from.id : owningPageId;
        if (!pageId) continue;

        let pageClient = pageClients.get(pageId);
        if (pageClient === undefined) {
          const tokenResult = await fetchGraph(
            client,
            `page_token_${pageId}`,
            graphUrl(client, `/${pageId}`, { fields: "access_token" }),
            warnings,
            "Resolving a Page-hosted video file requires an admin role on the owning Page and the pages_show_list scope.",
          );
          const pageAccessToken = typeof tokenResult?.access_token === "string" ? tokenResult.access_token : undefined;
          pageClient = pageAccessToken ? new MetaClient(pageAccessToken, client.apiVersion) : null;
          pageClients.set(pageId, pageClient);
        }
        if (!pageClient) continue;

        const retried = await fetchGraph(
          pageClient,
          `video_${video.id}_via_page`,
          graphUrl(pageClient, `/${encodeURIComponent(String(video.id))}`, { fields: videoFields }),
          warnings,
          "The Page token could not read this video: verify the Page role covers content access.",
        );
        if (retried && typeof retried.source === "string") Object.assign(video, retried);
      }

      const videos = fetched.map((video) => normalizeAdVideo(video, true));
      const withoutSource = videos.filter((video) => video.source === undefined).length;
      if (withoutSource > 0) {
        warnings.push({
          area: "video_sources",
          message: `${withoutSource} video(s) returned no source file even via their owning Page.`,
          suggestion: "Their thumbnails and metadata remain available; the file requires a token holding an admin role on the owning Page.",
        });
      }

      return ok({
        videos,
        count: videos.length,
        warnings,
        limitations: [
          "source URLs are signed, publicly fetchable download links that expire quickly: use them immediately and re-call this tool for fresh ones.",
          "Videos owned by a Facebook Page (boosted posts) are resolved through the Page's own token when this connection administers the Page; otherwise thumbnails and metadata are returned without the file.",
        ],
      });
    },
  );
}
