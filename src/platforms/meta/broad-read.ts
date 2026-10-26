/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatMcpToolError } from "../../core/errors.js";
import type { MetaClient } from "./client.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };
type SuccessResponder = (data: unknown) => ToolResult;

const graphIdSchema = z.string().trim().min(1).max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Use a Graph node ID without slashes or query parameters");
const graphFieldSchema = z.string().trim().min(1).max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Use a plain Graph field name");
const graphDimensionSchema = z.string().trim().min(1).max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Use a plain Insights field or breakdown name");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const META_BROAD_READ_EDGES = [
  "accounts",
  "activities",
  "ad_studies",
  "adcreatives",
  "adimages",
  "adspixels",
  "advideos",
  "ads",
  "adsets",
  "assigned_pages",
  "assigned_ad_accounts",
  "campaigns",
  "client_ad_accounts",
  "client_data_sets",
  "client_instagram_accounts",
  "client_pages",
  "client_pixels",
  "client_product_catalogs",
  "client_publisher_block_lists",
  "customaudiences",
  "customconversions",
  "delivery_estimate",
  "feed",
  "instagram_accounts",
  "media",
  "leadgen_forms",
  "offline_conversion_data_sets",
  "owned_ad_accounts",
  "owned_data_sets",
  "owned_instagram_accounts",
  "owned_pages",
  "owned_pixels",
  "owned_product_catalogs",
  "owned_publisher_block_lists",
  "pages",
  "pixels",
  "posts",
  "product_catalogs",
  "product_sets",
  "products",
  "publisher_block_lists",
  "reachestimate",
  "reachfrequencypredictions",
  "saved_audiences",
  "videos",
  "cells",
  "objectives",
] as const;

const readEdgeSchema = z.enum(META_BROAD_READ_EDGES);

const filterValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(500), z.number().finite(), z.boolean()])).max(500),
]);

const graphFilterSchema = z.object({
  field: z.string().trim().min(1).max(150)
    .regex(/^[A-Za-z][A-Za-z0-9_.]*$/, "Invalid filtering field"),
  operator: z.enum([
    "EQUAL", "NOT_EQUAL", "GREATER_THAN", "GREATER_THAN_OR_EQUAL",
    "LESS_THAN", "LESS_THAN_OR_EQUAL", "IN_RANGE", "NOT_IN_RANGE",
    "CONTAIN", "NOT_CONTAIN", "IN", "NOT_IN", "STARTS_WITH", "ENDS_WITH",
    "ANY", "ALL", "NONE",
  ]),
  value: filterValueSchema,
});

const datePresetSchema = z.enum([
  "today", "yesterday", "this_month", "last_month", "this_quarter",
  "maximum", "data_maximum", "last_3d", "last_7d", "last_14d",
  "last_28d", "last_30d", "last_90d", "last_week_mon_sun",
  "last_week_sun_sat", "last_quarter", "last_year",
  "this_week_mon_today", "this_week_sun_today", "this_year",
]);

const targetingSearchTypeSchema = z.enum([
  "adinterest",
  "adbehaviors",
  "adinterestsuggestion",
  "adinterestvalid",
  "adgeolocation",
  "adgeolocationmeta",
  "adlocale",
  "adcountry",
  "adcity",
  "adregion",
  "admarket",
  "adzipcode",
  "adTargetingCategory",
  "adworkemployer",
  "adworkposition",
  "adeducationschool",
  "adeducationmajor",
]);

export function buildMetaGraphReadUrl(
  apiVersion: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const normalizedPath = path.replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.includes("..") || /[?#]/.test(normalizedPath)) {
    throw new Error("Invalid Meta Graph read path.");
  }
  const url = new URL(`https://graph.facebook.com/${apiVersion}/${normalizedPath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function encodeExtraGraphParams(rawParams: Record<string, unknown> | undefined): Record<string, string> {
  if (!rawParams) return {};
  const entries = Object.entries(rawParams);
  if (entries.length > 50) throw new Error("At most 50 extra Graph parameters are allowed.");
  const blocked = new Set([
    "access_token", "appsecret_proof", "signed_request", "method", "http_method", "batch",
    "fields", "filtering", "since", "until", "limit", "after", "before", "summary",
  ]);
  const encoded: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid Graph parameter key: ${key}`);
    if (blocked.has(key.toLowerCase())) throw new Error(`Graph parameter ${key} must use the dedicated input or is blocked for safety.`);
    if (value === undefined || value === null || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new Error(`Graph parameter ${key} must be a JSON-compatible scalar, array, or object.`);
    }
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (rendered.length > 10_000) throw new Error(`Graph parameter ${key} exceeds 10,000 characters.`);
    encoded[key] = rendered;
  }
  if (JSON.stringify(encoded).length > 25_000) throw new Error("Encoded extra Graph parameters exceed 25,000 characters.");
  return encoded;
}

function requireOneTimeSelector(datePreset: string | undefined, timeRange: { since: string; until: string } | undefined): void {
  if (datePreset && timeRange) {
    throw new Error("Pass either datePreset or timeRange, not both.");
  }
  if (timeRange && timeRange.since > timeRange.until) {
    throw new Error("timeRange.since must be on or before timeRange.until.");
  }
}

export function registerMetaBroadReadTools(
  server: McpServer,
  client: MetaClient,
  ok: SuccessResponder,
): void {
  server.tool(
    "meta_get_node_fields",
    "Read arbitrary flat fields from one Meta Graph node. This GET-only escape hatch covers newly released campaign, ad set, ad, creative, audience, catalog, Page, Instagram, pixel, and other accessible node fields without waiting for a fixed MCP schema update.",
    {
      nodeId: graphIdSchema.describe("Graph node ID, for example a campaign, ad set, ad, creative, Page, IG account, pixel, audience, or catalog ID"),
      fields: z.array(graphFieldSchema).min(1).max(100).describe("Flat Graph field names; nested field expansion is intentionally disabled"),
      includeMetadata: z.boolean().prefault(false).describe("Ask Graph for field metadata when supported"),
    },
    async ({ nodeId, fields, includeMetadata }) => {
      try {
        const url = buildMetaGraphReadUrl(client.apiVersion, nodeId, {
          fields: [...new Set(fields)].join(","),
          metadata: includeMetadata ? 1 : undefined,
        });
        const data = await client.fetchUrl(url);
        return ok({ data, nodeId, requestedFields: [...new Set(fields)] });
      } catch (error) {
        return formatMcpToolError(error);
      }
    },
  );

  server.tool(
    "meta_list_edge_raw",
    "List an allowlisted read-only Meta Graph edge with caller-selected flat fields, filters, and cursor pagination. Use this for broad metadata/entity discovery when a specialized tool does not expose a newly added field.",
    {
      parentId: graphIdSchema.describe("Parent Graph node ID, such as act_123, a Business, Page, catalog, campaign, or ad set ID"),
      edge: readEdgeSchema,
      fields: z.array(graphFieldSchema).min(1).max(100).optional(),
      filtering: z.array(graphFilterSchema).max(20).optional(),
      parameters: z.record(z.string(), z.unknown()).optional().describe("Additional documented GET parameters, for example targeting_spec or optimization_goal; auth and HTTP method override parameters are blocked"),
      since: dateSchema.optional(),
      until: dateSchema.optional(),
      limit: z.number().int().min(1).max(500).prefault(100),
      after: z.string().max(2_000).optional(),
      before: z.string().max(2_000).optional(),
      includeSummary: z.boolean().prefault(false),
    },
    async ({ parentId, edge, fields, filtering, parameters, since, until, limit, after, before, includeSummary }) => {
      try {
        if (since && until && since > until) throw new Error("since must be on or before until.");
        if (after && before) throw new Error("Pass either after or before, not both.");
        const url = buildMetaGraphReadUrl(client.apiVersion, `${parentId}/${edge}`, {
          ...encodeExtraGraphParams(parameters),
          fields: fields ? [...new Set(fields)].join(",") : undefined,
          filtering: filtering?.length ? JSON.stringify(filtering) : undefined,
          since,
          until,
          limit,
          after,
          before,
          summary: includeSummary ? "true" : undefined,
        });
        const data = await client.fetchUrl(url);
        return ok({ data, parentId, edge, requestedFields: fields ?? [], paging: (data as Record<string, unknown>).paging });
      } catch (error) {
        return formatMcpToolError(error);
      }
    },
  );

  server.tool(
    "meta_get_insights_raw",
    "Query the Meta Insights edge with validated native field names, breakdowns, action breakdowns, attribution windows, filters, sort, summary, and pagination. This complements meta_get_insights when Meta adds fields before the curated metric catalog is updated.",
    {
      objectId: graphIdSchema.describe("Ad account (act_...), campaign, ad set, or ad ID whose /insights edge should be queried"),
      fields: z.array(graphDimensionSchema).min(1).max(100).describe("Native Meta Insights API fields; calculated aliases are not accepted here"),
      level: z.enum(["account", "campaign", "adset", "ad"]).optional(),
      breakdowns: z.array(graphDimensionSchema).max(20).optional(),
      actionBreakdowns: z.array(graphDimensionSchema).max(20).optional(),
      actionAttributionWindows: z.array(z.enum(["1d_click", "7d_click", "28d_click", "1d_view", "1d_ev", "dda", "skan_click", "skan_view"])).max(8).optional(),
      datePreset: datePresetSchema.optional(),
      timeRange: z.object({ since: dateSchema, until: dateSchema }).optional(),
      timeIncrement: z.union([z.number().int().min(1).max(90), z.enum(["monthly", "all_days"]) ]).optional(),
      filtering: z.array(graphFilterSchema).max(20).optional(),
      sort: z.string().trim().max(150).regex(/^[A-Za-z][A-Za-z0-9_.]*_(ascending|descending)$/).optional(),
      limit: z.number().int().min(1).max(500).prefault(100),
      after: z.string().max(2_000).optional(),
      includeSummary: z.boolean().prefault(false),
    },
    async ({ objectId, fields, level, breakdowns, actionBreakdowns, actionAttributionWindows, datePreset, timeRange, timeIncrement, filtering, sort, limit, after, includeSummary }) => {
      try {
        requireOneTimeSelector(datePreset, timeRange);
        const url = buildMetaGraphReadUrl(client.apiVersion, `${objectId}/insights`, {
          fields: [...new Set(fields)].join(","),
          level,
          breakdowns: breakdowns?.length ? [...new Set(breakdowns)].join(",") : undefined,
          action_breakdowns: actionBreakdowns?.length ? [...new Set(actionBreakdowns)].join(",") : undefined,
          action_attribution_windows: actionAttributionWindows?.length ? [...new Set(actionAttributionWindows)].join(",") : undefined,
          date_preset: datePreset,
          time_range: timeRange ? JSON.stringify(timeRange) : undefined,
          time_increment: timeIncrement,
          filtering: filtering?.length ? JSON.stringify(filtering) : undefined,
          sort,
          limit,
          after,
          summary: includeSummary ? "true" : undefined,
        });
        const data = await client.fetchUrl(url);
        return ok({
          data: (data as Record<string, unknown>).data ?? data,
          paging: (data as Record<string, unknown>).paging,
          summary: (data as Record<string, unknown>).summary,
          nativeFields: true,
        });
      } catch (error) {
        return formatMcpToolError(error);
      }
    },
  );

  server.tool(
    "meta_search_targeting_options",
    "Search Meta's read-only targeting metadata for interests, validated interests, geographies, locales, countries, cities, regions, markets, or postal codes.",
    {
      type: targetingSearchTypeSchema,
      query: z.string().trim().min(1).max(200).optional().describe("Search text; required by most interest and geography searches"),
      countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
      locationTypes: z.array(z.enum(["country", "country_group", "region", "city", "zip", "geo_market", "electoral_district"])).max(7).optional(),
      limit: z.number().int().min(1).max(1000).prefault(100),
    },
    async ({ type, query, countryCode, locationTypes, limit }) => {
      try {
        if ((type === "adinterest" || type === "adinterestvalid") && !query) {
          throw new Error(`${type} requires query.`);
        }
        const url = buildMetaGraphReadUrl(client.apiVersion, "search", {
          type,
          q: query,
          country_code: countryCode,
          location_types: locationTypes?.length ? JSON.stringify(locationTypes) : undefined,
          limit,
        });
        const data = await client.fetchUrl(url);
        return ok({ data: (data as Record<string, unknown>).data ?? data, paging: (data as Record<string, unknown>).paging, search: { type, query, countryCode, locationTypes } });
      } catch (error) {
        return formatMcpToolError(error);
      }
    },
  );

  server.tool(
    "meta_get_ad_preview",
    "Get the read-only preview markup for an existing Meta ad in a requested placement format. The response may contain an iframe body but never creates or edits a creative.",
    {
      adId: graphIdSchema,
      adFormat: z.string().trim().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/).prefault("DESKTOP_FEED_STANDARD"),
    },
    async ({ adId, adFormat }) => {
      try {
        const preview = await client.getAdPreview(adId, adFormat);
        return ok({ adId, adFormat, preview, readOnly: true });
      } catch (error) {
        return formatMcpToolError(error);
      }
    },
  );
}
