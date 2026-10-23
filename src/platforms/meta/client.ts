/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { measurementParams } from "./reporting-context.js";
// ============================================
// META GRAPH API CLIENT (READ-ONLY)
// Meta Graph API client for read-only calls.
// communication with Meta Marketing API
// ============================================

import { logger } from "../../core/logger.js";
import { RateLimiter } from "../../core/rate-limiter.js";
import { readBoundedJson, ResponseTooLargeError } from "../../core/http.js";

// ============================================
// CONSTANTS
// ============================================

const META_GRAPH_API_BASE = "https://graph.facebook.com";
export const DEFAULT_API_VERSION = "v26.0";
const DEFAULT_LIMIT = 500;

/**
 * Keep bearer credentials on Meta's Graph host. Tool-built URLs and Graph
 * paging URLs both pass through this guard before a token is attached.
 */
export function assertSafeMetaGraphUrl(rawUrl: string, apiVersion: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Meta Graph URL must be an absolute HTTPS URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "graph.facebook.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Meta Graph reads are restricted to https://graph.facebook.com.");
  }

  const versionPrefix = `/${apiVersion.replace(/^\/+|\/+$/g, "")}/`;
  if (!url.pathname.startsWith(versionPrefix) && url.pathname !== versionPrefix.slice(0, -1)) {
    throw new Error(`Meta Graph URL must use the configured API version ${apiVersion}.`);
  }

  return url;
}

const META_REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGINATION_PAGES = 20;
const MAX_PAGINATION_ROWS = 10_000;
const MAX_PAGE_ROWS = 1_000;
const MAX_SEARCH_ENTITY_ROWS = 500;

function trustedMetaGraphUrl(
  rawUrl: string,
  apiVersion: string,
  expectedPathname?: string,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Meta Graph URL is invalid.");
  }

  const versionSegment = parsed.pathname.split("/").filter(Boolean)[0];
  if (
    parsed.protocol !== "https:"
    || parsed.origin !== META_GRAPH_API_BASE
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
    || versionSegment !== apiVersion
    || (expectedPathname !== undefined && parsed.pathname !== expectedPathname)
  ) {
    throw new Error("Meta Graph URL failed the trusted origin, API-version, and route policy.");
  }

  // Meta may repeat the same bearer in paging URLs. Keep authority in the
  // header so a URL is never the credential carrier.
  parsed.searchParams.delete("access_token");
  return parsed;
}

// ============================================
// TYPES (inlined, so there is no external dependency)
// ============================================

export interface MetaApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  error_user_msg?: string;
  error_user_title?: string;
  fbtrace_id?: string;
}

export interface MetaTokenInfo {
  app_id?: string;
  user_id?: string;
  type?: string;
  expires_at?: number;
  data_access_expires_at?: number;
  is_valid: boolean;
  scopes?: string[];
}

export interface MetaAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

interface MetaAdAccountsResponse {
  data: MetaAdAccount[];
  paging?: { cursors?: { before: string; after: string }; next?: string };
}

export interface MetaApiRequest {
  type: string;
  fields: string[];
  level: string;
  limit?: number;
  timeRange?: { since: string; until: string };
  datePreset?: string;
  timeIncrement?: number | string;
  breakdowns?: string[];
  actionBreakdowns?: string[];
  attributionWindows?: string[];
  attributionMode?: "account" | "adset" | "explicit";
  actionReportTime?: "impression" | "conversion" | "mixed";
  filtering?: Array<{ field: string; operator: string; value: unknown }>;
}

export interface InsightRow {
  [key: string]: unknown;
}

interface InsightsApiResponse {
  data: InsightRow[];
  paging?: { cursors?: { before: string; after: string }; next?: string };
}

export interface QueryPlan {
  requests: MetaApiRequest[];
  joinKeys: string[];
  calculatedMetrics: string[];
  errors: string[];
  warnings: string[];
}

export interface QueryDebugInfo {
  requestCount: number;
  rawRequests: MetaApiRequest[];
  calculatedMetrics: string[];
  joinKeys: string[];
  executionTimeMs: number;
  rowCount: number;
  warnings: string[];
}

export interface InsightsResponse {
  data: InsightRow[];
  debug: QueryDebugInfo;
}

// Ad Study types
export interface AdStudy {
  id: string;
  name?: string;
  type?: string;
  description?: string;
  created_time?: string;
  start_time?: string;
  end_time?: string;
  results_first_available_date?: string;
  canceled_time?: string;
  observation_end_time?: string;
  cooldown_start_time?: string;
}

export interface AdStudyCell {
  id: string;
  name?: string;
  treatment_percentage?: number;
  control_percentage?: number;
  ad_entities_count?: number;
}

export interface AdStudyObjective {
  id: string;
  name?: string;
  type?: string;
  is_primary?: boolean;
  last_updated_results?: string;
  results?: unknown;
  custom_attributes?: unknown;
}

interface AdStudiesResponse {
  data: AdStudy[];
  paging?: { next?: string };
}

interface AdStudyCellsResponse {
  data: AdStudyCell[];
  paging?: { next?: string };
}

interface AdStudyObjectivesResponse {
  data: AdStudyObjective[];
  paging?: { next?: string };
}

// ============================================
// ERROR HANDLING
// ============================================

export class MetaApiException extends Error {
  public readonly code: number;
  public readonly type: string;
  public readonly subcode?: number;
  public readonly userMessage?: string;
  public readonly userTitle?: string;
  public readonly fbtraceId?: string;

  constructor(error: MetaApiError) {
    // Include error_user_msg when present, since it carries the actual detail
    const fullMessage = error.error_user_msg
      ? `${error.message}: ${error.error_user_msg}`
      : error.message;
    super(fullMessage);
    this.name = "MetaApiException";
    this.code = error.code;
    this.type = error.type;
    this.subcode = error.error_subcode;
    this.userMessage = error.error_user_msg;
    this.userTitle = error.error_user_title;
    this.fbtraceId = error.fbtrace_id;
  }

  get isRateLimitError(): boolean {
    return this.code === 613 || this.code === 17;
  }

  get isAuthError(): boolean {
    return this.code === 190 || this.code === 102;
  }

  get isPermissionError(): boolean {
    return this.code === 200 || this.code === 10;
  }

  get isInvalidParameterError(): boolean {
    return this.code === 100;
  }

  get suggestion(): string {
    if (this.isRateLimitError) {
      return "Rate limit exceeded. Wait and retry with exponential backoff.";
    }
    if (this.isAuthError) {
      return "Authentication failed. Refresh the access token.";
    }
    if (this.isPermissionError) {
      return "Permission denied. Verify ad account access permissions.";
    }
    if (this.isInvalidParameterError) {
      return "Invalid parameter. Check metric/breakdown compatibility.";
    }
    return "Check the Meta API documentation for error details.";
  }
}

// ============================================
// RESPONSE NORMALIZATION
// ============================================

/**
 * Normalize an insight row to extract readable values from creative breakdowns.
 * Some breakdowns return objects with id/name, we want to extract the readable name.
 */
function normalizeInsightRow(row: InsightRow): InsightRow {
  const normalized = { ...row };

  // For ad_format_asset, if it's an object, extract the name
  if (normalized.ad_format_asset !== undefined) {
    const value = normalized.ad_format_asset as unknown;
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      if ("name" in obj && typeof obj.name === "string") {
        normalized.ad_format_asset = obj.name;
      } else if ("id" in obj) {
        normalized.ad_format_asset = String(obj.id);
      }
    }
  }

  // Similar normalization for media_type and media_format
  if (normalized.media_type !== undefined) {
    const value = normalized.media_type as unknown;
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      if ("name" in obj && typeof obj.name === "string") {
        normalized.media_type = obj.name;
      } else if ("value" in obj && typeof obj.value === "string") {
        normalized.media_type = obj.value;
      }
    }
  }

  if (normalized.media_format !== undefined) {
    const value = normalized.media_format as unknown;
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      if ("name" in obj && typeof obj.name === "string") {
        normalized.media_format = obj.name;
      } else if ("value" in obj && typeof obj.value === "string") {
        normalized.media_format = obj.value;
      }
    }
  }

  return normalized;
}

// ============================================
// API CLIENT (READ-ONLY)
// ============================================

/**
 * Meta Graph API client, read-only.
 * Accepts an access token via constructor and makes only
 * GET requests against the Meta Marketing API.
 */
export class MetaClient {
  private accessToken: string;
  public readonly apiVersion: string;
  private rateLimiter: RateLimiter;

  constructor(accessToken: string, apiVersion: string = DEFAULT_API_VERSION) {
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.rateLimiter = new RateLimiter("meta");
  }

  /**
   * Set a new access token.
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Get the current access token (for direct API calls outside MetaClient).
   */
  getAccessToken(): string {
    return this.accessToken;
  }

  /**
   * Get the base URL for API requests.
   */
  private getBaseUrl(): string {
    return `${META_GRAPH_API_BASE}/${this.apiVersion}`;
  }

  /**
   * Meta can echo request values in error text. Keep the bearer credential
   * out of logs and tool errors, including when the diagnostic itself fails.
   */
  private safeApiError(error: MetaApiError, fallbackCode: number): MetaApiError {
    const redact = (value: unknown): string | undefined => typeof value === "string"
      ? value.replaceAll(this.accessToken, "[redacted]")
      : undefined;
    return {
      message: redact(error.message) ?? `Meta HTTP ${fallbackCode}`,
      type: redact(error.type) ?? "OAuthException",
      code: typeof error.code === "number" ? error.code : fallbackCode,
      error_subcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
      error_user_msg: redact(error.error_user_msg),
      error_user_title: redact(error.error_user_title),
      fbtrace_id: redact(error.fbtrace_id),
    };
  }

  /**
   * Fetch any Meta Graph API URL (with rate limiting and access token).
   * Useful for tools that build URLs directly.
   */
  async fetchUrl(url: string): Promise<Record<string, unknown>> {
    const trustedUrl = trustedMetaGraphUrl(url, this.apiVersion);
    return this.rateLimiter.execute(async () => {
      logger.debug("meta", `fetchUrl: ${trustedUrl.origin}${trustedUrl.pathname}`);
      let response: Response;
      try {
        response = await fetch(trustedUrl, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
          redirect: "error",
        });
      } catch {
        throw new Error("Meta could not be reached for this read-only request.");
      }
      let data: Record<string, unknown> | null;
      try {
        data = await readBoundedJson<Record<string, unknown> | null>(response);
      } catch (error) {
        if (error instanceof ResponseTooLargeError) throw error;
        if (!response.ok) data = null;
        else throw new Error("Meta returned an unreadable response to this read-only request.");
      }
      if (!response.ok || (data && typeof data === "object" && "error" in data && data.error)) {
        const errorInfo = (data?.error ?? {}) as Record<string, unknown>;
        throw new MetaApiException(this.safeApiError({
          message: (errorInfo.message as string) ?? `HTTP ${response.status}`,
          type: (errorInfo.type as string) ?? "OAuthException",
          code: (errorInfo.code as number) ?? response.status,
          error_subcode: errorInfo.error_subcode as number | undefined,
          error_user_msg: errorInfo.error_user_msg as string | undefined,
          error_user_title: errorInfo.error_user_title as string | undefined,
          fbtrace_id: errorInfo.fbtrace_id as string | undefined,
        }, response.status));
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Meta returned an invalid response to this read-only request.");
      }
      return data;
    });
  }

  /**
   * Make a rate-limited GET API request. The token travels in the
   * Authorization header, never in the URL.
   */
  private async request<T>(
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<T> {
    return this.rateLimiter.execute(async () => {
      const url = new URL(`${this.getBaseUrl()}${endpoint}`);

      // Add additional params
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.append(key, value);
        }
      }

      logger.debug("meta", `GET ${endpoint}`, {
        fields: params?.fields?.slice(0, 120) ?? "(none)",
      });

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
          },
          signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
          redirect: "error",
        });
      } catch {
        throw new Error("Meta could not be reached for this read-only request.");
      }

      let data: Record<string, unknown>;
      try { data = await readBoundedJson<Record<string, unknown>>(response); }
      catch (error) {
        if (error instanceof ResponseTooLargeError) throw error;
        throw new Error("Meta returned an unreadable response to this read-only request.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Meta returned an invalid response to this read-only request.");
      }

      // Check for errors, including an error body on HTTP 200
      if (!response.ok || data.error) {
        const safeError = this.safeApiError((data.error ?? {}) as MetaApiError, response.status);
        logger.error("meta", `API error on ${endpoint}`, safeError);
        throw new MetaApiException(safeError);
      }

      return data as T;
    });
  }

  // ============================================
  // TOKEN DEBUG
  // ============================================

  /**
   * Inspect the configured token with itself. Meta answers only when the
   * token's user develops or administers the app (System User tokens do);
   * otherwise use getGrantedPermissions and getCurrentUserIdentity.
   */
  async debugToken(): Promise<MetaTokenInfo> {
    const response = await this.request<{ data?: MetaTokenInfo }>("/debug_token", {
      input_token: this.accessToken,
    });
    const data = response.data;
    if (!data || typeof data.is_valid !== "boolean") {
      throw new Error("Meta token inspection returned incomplete metadata. Token validity and permissions remain unverified.");
    }
    // Return only known diagnostic metadata, never arbitrary provider fields.
    return {
      is_valid: data.is_valid,
      ...(typeof data.app_id === "string" ? { app_id: data.app_id } : {}),
      ...(typeof data.user_id === "string" ? { user_id: data.user_id } : {}),
      ...(typeof data.type === "string" ? { type: data.type } : {}),
      ...(typeof data.expires_at === "number" ? { expires_at: data.expires_at } : {}),
      ...(typeof data.data_access_expires_at === "number" ? { data_access_expires_at: data.data_access_expires_at } : {}),
      ...(Array.isArray(data.scopes) && data.scopes.every(scope => typeof scope === "string") ? { scopes: data.scopes } : {}),
    };
  }

  /** The connecting user's grants, independently of token inspection. */
  async getGrantedPermissions(): Promise<string[]> {
    type PermissionPage = { data?: { permission: string; status: string }[]; paging?: { next?: string } };
    const grants = new Set<string>();
    let page = await this.request<PermissionPage>("/me/permissions", { limit: "100" });
    for (let count = 1; count <= MAX_PAGINATION_PAGES; count++) {
      if (!Array.isArray(page.data) || page.data.some(row => !row || typeof row.permission !== "string" || !["granted", "declined", "expired"].includes(row.status))) {
        throw new Error("Meta permission inspection returned incomplete data. Granted permissions remain unknown.");
      }
      for (const row of page.data) if (row.status === "granted") grants.add(row.permission);
      if (!page.paging?.next) return [...grants];
      if (count === MAX_PAGINATION_PAGES) break;
      const url = trustedMetaGraphUrl(page.paging.next, this.apiVersion, `/${this.apiVersion}/me/permissions`);
      page = await this.fetchUrl(url.toString()) as PermissionPage;
    }
    throw new Error("Meta permission inspection was incomplete. Granted permissions remain unknown.");
  }

  async getCurrentUserIdentity(): Promise<{ id: string; name?: string }> {
    const data = await this.request<{ id?: unknown; name?: unknown }>("/me", { fields: "id,name" });
    if (typeof data.id !== "string" || !data.id) throw new Error("Meta did not return the connecting user's identity.");
    return { id: data.id, ...(typeof data.name === "string" ? { name: data.name } : {}) };
  }

  // ============================================
  // AD ACCOUNT METHODS
  // ============================================

  /**
   * Get all ad accounts the user has access to.
   */
  async getAdAccounts(): Promise<MetaAdAccount[]> {
    const allAccounts: MetaAdAccount[] = [];
    let nextUrl: string | undefined;
    let pageCount = 1;
    const expectedPathname = `/${this.apiVersion}/me/adaccounts`;

    // First request
    const firstResponse = await this.request<MetaAdAccountsResponse>(
      "/me/adaccounts",
      {
        fields:
          "id,account_id,name,currency,timezone_name,account_status",
        limit: "100",
      },
    );

    allAccounts.push(...firstResponse.data.slice(0, MAX_PAGINATION_ROWS));
    nextUrl = firstResponse.paging?.next;

    // Paginate through all accounts
    while (
      nextUrl
      && pageCount < MAX_PAGINATION_PAGES
      && allAccounts.length < MAX_PAGINATION_ROWS
    ) {
      const paginatedData = await this.fetchPaginatedUrl<
        MetaAdAccountsResponse & { error?: MetaApiError }
      >(nextUrl, expectedPathname);

      if (paginatedData.error) {
        throw new MetaApiException(paginatedData.error);
      }

      const remainingRows = MAX_PAGINATION_ROWS - allAccounts.length;
      allAccounts.push(...paginatedData.data.slice(0, remainingRows));
      nextUrl = paginatedData.paging?.next;
      pageCount += 1;
    }

    if (nextUrl) {
      throw new Error("Meta ad-account pagination exceeded its page or row safety cap.");
    }

    return allAccounts;
  }

  /**
   * Get a specific ad account.
   */
  async getAdAccount(adAccountId: string): Promise<MetaAdAccount> {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;

    return this.request<MetaAdAccount>(`/${accountId}`, {
      fields:
        "id,account_id,name,currency,timezone_name,account_status",
    });
  }

  // ============================================
  // INSIGHTS METHODS
  // ============================================

  /**
   * Fetch insights for a single API request.
   */
  async fetchInsights(
    adAccountId: string,
    apiRequest: MetaApiRequest,
  ): Promise<InsightRow[]> {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;

    const allRows: InsightRow[] = [];
    let nextUrl: string | undefined;
    let pageCount = 1;
    const expectedPathname = `/${this.apiVersion}/${accountId}/insights`;

    // Build initial params
    const params: Record<string, string> = {
      fields: apiRequest.fields.join(","),
      level: apiRequest.level,
      limit: String(Math.min(Math.max(apiRequest.limit || DEFAULT_LIMIT, 1), MAX_PAGE_ROWS)),
    };

    // Time range or preset
    if (apiRequest.timeRange) {
      params.time_range = JSON.stringify({
        since: apiRequest.timeRange.since,
        until: apiRequest.timeRange.until,
      });
    } else if (apiRequest.datePreset) {
      params.date_preset = apiRequest.datePreset;
    }

    // Time increment
    if (apiRequest.timeIncrement) {
      params.time_increment = String(apiRequest.timeIncrement);
    }

    // Breakdowns - only add if present and non-empty
    if (apiRequest.breakdowns && apiRequest.breakdowns.length > 0) {
      params.breakdowns = apiRequest.breakdowns.join(",");
    }

    // Action breakdowns - only add if present and non-empty
    if (
      apiRequest.actionBreakdowns &&
      apiRequest.actionBreakdowns.length > 0
    ) {
      params.action_breakdowns = apiRequest.actionBreakdowns.join(",");
    }

    // Omit windows unless explicitly requested; never silently request five windows.
    Object.assign(params, measurementParams(apiRequest));

    // Filtering (e.g., filter by ad IDs)
    if (apiRequest.filtering && apiRequest.filtering.length > 0) {
      params.filtering = JSON.stringify(apiRequest.filtering);
    }

    logger.info("meta", "Fetching insights", {
      type: apiRequest.type,
      accountId,
      breakdowns: params.breakdowns || "(none)",
      action_breakdowns: params.action_breakdowns || "(none)",
      fieldCount: apiRequest.fields.length,
    });

    // First request
    const firstResponse = await this.request<InsightsApiResponse>(
      `/${accountId}/insights`,
      params,
    );

    allRows.push(...firstResponse.data.slice(0, MAX_PAGINATION_ROWS).map(normalizeInsightRow));
    nextUrl = firstResponse.paging?.next;

    // Paginate through all results
    while (
      nextUrl
      && pageCount < MAX_PAGINATION_PAGES
      && allRows.length < MAX_PAGINATION_ROWS
    ) {
      const data = await this.fetchPaginatedUrl<
        InsightsApiResponse & { error?: MetaApiError }
      >(nextUrl, expectedPathname);

      if (data.error) {
        throw new MetaApiException(data.error);
      }

      const remainingRows = MAX_PAGINATION_ROWS - allRows.length;
      allRows.push(...data.data.slice(0, remainingRows).map(normalizeInsightRow));
      nextUrl = data.paging?.next;
      pageCount += 1;
    }

    if (nextUrl) {
      throw new Error("Meta insights pagination exceeded its page or row safety cap.");
    }

    return allRows;
  }

  /**
   * Execute a query plan (multiple API requests) and merge results.
   */
  async executeQueryPlan(
    adAccountId: string,
    plan: QueryPlan,
    mergeResults: (
      results: Record<string, unknown>[][],
      joinKeys: string[],
    ) => Record<string, unknown>[],
  ): Promise<{ data: InsightRow[]; debug: QueryDebugInfo }> {
    const startTime = Date.now();

    if (plan.errors.length > 0) {
      throw new Error(`Query plan has errors: ${plan.errors.join(", ")}`);
    }

    // Execute all requests
    const results: InsightRow[][] = [];

    for (const request of plan.requests) {
      const rows = await this.fetchInsights(adAccountId, request);
      results.push(rows);
    }

    // Merge results
    const mergedData = mergeResults(
      results as Record<string, unknown>[][],
      plan.joinKeys,
    ) as InsightRow[];

    const executionTimeMs = Date.now() - startTime;

    return {
      data: mergedData,
      debug: {
        requestCount: plan.requests.length,
        rawRequests: plan.requests,
        calculatedMetrics: plan.calculatedMetrics,
        joinKeys: plan.joinKeys,
        executionTimeMs,
        rowCount: mergedData.length,
        warnings: plan.warnings,
      },
    };
  }

  // ============================================
  // ENTITY METADATA FETCHING
  // ============================================

  /**
   * Fetch metadata fields for multiple entities using batch IDs endpoint.
   * Uses GET /?ids=id1,id2,...&fields=field1,field2 for efficient batch fetching.
   */
  async fetchEntityMetadata(
    entityIds: string[],
    fields: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();
    if (entityIds.length === 0 || fields.length === 0) return result;

    const BATCH_SIZE = 50;
    const fieldsStr = fields.join(",");

    for (let i = 0; i < entityIds.length; i += BATCH_SIZE) {
      const batch = entityIds.slice(i, i + BATCH_SIZE);
      const idsStr = batch.join(",");

      const data = await this.request<
        Record<string, Record<string, unknown>>
      >("", { ids: idsStr, fields: fieldsStr });

      for (const [entityId, metadata] of Object.entries(data)) {
        if (metadata && typeof metadata === "object") {
          result.set(entityId, metadata);
        }
      }
    }

    return result;
  }

  // ============================================
  // ASYNC REPORTING (for large queries)
  // ============================================

  /**
   * Check async report status.
   */
  async getAsyncReportStatus(reportRunId: string): Promise<{
    id: string;
    async_status:
      | "Job Not Started"
      | "Job Started"
      | "Job Running"
      | "Job Completed"
      | "Job Failed"
      | "Job Skipped";
    async_percent_completion: number;
  }> {
    return this.request(`/${reportRunId}`, {
      fields: "id,async_status,async_percent_completion",
    });
  }

  /**
   * Get async report results.
   */
  async getAsyncReportResults(
    reportRunId: string,
  ): Promise<InsightRow[]> {
    const allRows: InsightRow[] = [];
    let nextUrl: string | undefined;
    let pageCount = 1;
    const expectedPathname = `/${this.apiVersion}/${reportRunId}/insights`;

    const firstResponse = await this.request<InsightsApiResponse>(
      `/${reportRunId}/insights`,
      { limit: "500" },
    );

    allRows.push(...firstResponse.data.slice(0, MAX_PAGINATION_ROWS));
    nextUrl = firstResponse.paging?.next;

    while (
      nextUrl
      && pageCount < MAX_PAGINATION_PAGES
      && allRows.length < MAX_PAGINATION_ROWS
    ) {
      const data = await this.fetchPaginatedUrl<
        InsightsApiResponse & { error?: MetaApiError }
      >(nextUrl, expectedPathname);

      if (data.error) {
        throw new MetaApiException(data.error);
      }

      const remainingRows = MAX_PAGINATION_ROWS - allRows.length;
      allRows.push(...data.data.slice(0, remainingRows));
      nextUrl = data.paging?.next;
      pageCount += 1;
    }

    if (nextUrl) {
      throw new Error("Meta async-report pagination exceeded its page or row safety cap.");
    }

    return allRows;
  }

  /**
   * Wait for async report to complete and get results.
   */
  async waitForAsyncReport(
    reportRunId: string,
    pollIntervalMs: number = 2000,
    maxWaitMs: number = 300000,
  ): Promise<InsightRow[]> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getAsyncReportStatus(reportRunId);

      if (status.async_status === "Job Completed") {
        return this.getAsyncReportResults(reportRunId);
      }

      if (status.async_status === "Job Failed") {
        throw new Error(`Async report failed: ${reportRunId}`);
      }

      if (status.async_status === "Job Skipped") {
        throw new Error(`Async report was skipped: ${reportRunId}`);
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Async report timed out after ${maxWaitMs}ms`);
  }

  // ============================================
  // EXPERIMENT / AD STUDY METHODS
  // ============================================

  /**
   * Fetch all ad studies (experiments).
   * Fetches from three edges to capture all studies:
   * 1. /{ad_account_id}/ad_studies
   * 2. /{business_id}/ad_studies
   * 3. /me/ad_studies
   * Results are deduplicated by study ID.
   */
  async getAdStudies(adAccountId: string): Promise<AdStudy[]> {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;

    const fields = [
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

    const seenIds = new Set<string>();
    const allStudies: AdStudy[] = [];
    let remainingPageBudget = MAX_PAGINATION_PAGES;

    // Helper to paginate through an ad_studies edge
    const fetchFromEdge = async (endpoint: string) => {
      try {
        if (remainingPageBudget < 1 || allStudies.length >= MAX_PAGINATION_ROWS) return;
        remainingPageBudget -= 1;
        const firstResponse = await this.request<AdStudiesResponse>(
          endpoint,
          { fields, limit: "100" },
        );

        for (const study of firstResponse.data.slice(0, MAX_PAGINATION_ROWS - allStudies.length)) {
          if (!seenIds.has(study.id)) {
            seenIds.add(study.id);
            allStudies.push(study);
          }
        }

        let nextUrl = firstResponse.paging?.next;
        const expectedPathname = `/${this.apiVersion}${endpoint}`;
        while (
          nextUrl
          && remainingPageBudget > 0
          && allStudies.length < MAX_PAGINATION_ROWS
        ) {
          remainingPageBudget -= 1;
          const data = await this.fetchPaginatedUrl<
            AdStudiesResponse & { error?: MetaApiError }
          >(nextUrl, expectedPathname);
          if (data.error) break; // Don't throw, just stop paginating
          for (const study of data.data.slice(0, MAX_PAGINATION_ROWS - allStudies.length)) {
            if (!seenIds.has(study.id)) {
              seenIds.add(study.id);
              allStudies.push(study);
            }
          }
          nextUrl = data.paging?.next;
        }
      } catch (e) {
        // Silently skip if this edge doesn't work
        logger.warn(
          "meta",
          `Failed to fetch from ${endpoint}`,
          e instanceof Error ? e.message : e,
        );
      }
    };

    // 1. Fetch from ad account edge
    await fetchFromEdge(`/${accountId}/ad_studies`);

    // 2. Fetch the business_id from the ad account, then fetch business-level studies
    try {
      const accountInfo = await this.request<{
        business?: { id: string };
      }>(`/${accountId}`, { fields: "business{id}" });
      if (accountInfo.business?.id) {
        await fetchFromEdge(`/${accountInfo.business.id}/ad_studies`);
      }
    } catch (e) {
      logger.warn(
        "meta",
        "Failed to fetch business for ad account",
        e instanceof Error ? e.message : e,
      );
    }

    // 3. Also fetch from /me/ad_studies as fallback
    await fetchFromEdge("/me/ad_studies");

    return allStudies;
  }

  /**
   * Fetch cells for an ad study.
   */
  async getAdStudyCells(studyId: string): Promise<AdStudyCell[]> {
    const fields = [
      "id",
      "name",
      "treatment_percentage",
      "control_percentage",
      "ad_entities_count",
    ].join(",");

    const response = await this.request<AdStudyCellsResponse>(
      `/${studyId}/cells`,
      { fields, limit: "100" },
    );

    return response.data;
  }

  /**
   * Fetch objectives for an ad study, optionally with breakdowns.
   */
  async getAdStudyObjectives(
    studyId: string,
    breakdowns?: string[],
  ): Promise<AdStudyObjective[]> {
    const fields = [
      "id",
      "name",
      "type",
      "is_primary",
      "last_updated_results",
      "results",
      "custom_attributes",
    ].join(",");

    const params: Record<string, string> = { fields, limit: "100" };
    if (breakdowns && breakdowns.length > 0) {
      params.breakdowns = JSON.stringify(breakdowns);
    }

    const response = await this.request<AdStudyObjectivesResponse>(
      `/${studyId}/objectives`,
      params,
    );

    return response.data;
  }

  /**
   * Fetch objectives with minimal fields (no results, no breakdowns).
   * Fallback when the full objectives endpoint requires whitelist.
   */
  async getAdStudyObjectivesBasic(
    studyId: string,
  ): Promise<AdStudyObjective[]> {
    const fields = ["id", "name", "type", "is_primary"].join(",");

    const response = await this.request<AdStudyObjectivesResponse>(
      `/${studyId}/objectives`,
      { fields, limit: "100" },
    );

    return response.data;
  }

  /**
   * Fetch entity IDs associated with a study cell (campaigns, adsets, or adaccounts).
   */
  async getStudyCellEntities(
    cellId: string,
    entityType: "campaigns" | "adsets" | "adaccounts",
  ): Promise<Array<{ id: string; name?: string }>> {
    const response = await this.request<{
      data: Array<{ id: string; name?: string }>;
    }>(`/${cellId}/${entityType}`, { fields: "id,name", limit: "200" });

    return response.data;
  }

  // ============================================
  // READ-ONLY ENTITY METHODS
  // ============================================

  /**
   * Get pages the user manages.
   */
  async getPages(): Promise<
    Array<{ id: string; name: string; picture?: string }>
  > {
    const pages: Array<{
      id: string;
      name: string;
      picture?: string;
    }> = [];
    let nextUrl: string | null = null;
    let pageCount = 1;
    const expectedPathname = `/${this.apiVersion}/me/accounts`;

    const firstPage = await this.request<{
      data: Array<{
        id: string;
        name: string;
        picture?: { data?: { url?: string } };
      }>;
      paging?: { next?: string };
    }>("/me/accounts", {
      fields: "id,name,picture{url}",
      limit: "200",
    });

    for (const p of (firstPage.data || []).slice(0, MAX_PAGINATION_ROWS)) {
      pages.push({
        id: p.id,
        name: p.name,
        picture: p.picture?.data?.url,
      });
    }
    nextUrl = firstPage.paging?.next || null;

    while (
      nextUrl
      && pageCount < MAX_PAGINATION_PAGES
      && pages.length < MAX_PAGINATION_ROWS
    ) {
      const data = await this.fetchPaginatedUrl<{
        data: Array<{
          id: string;
          name: string;
          picture?: { data?: { url?: string } };
        }>;
        paging?: { next?: string };
        error?: MetaApiError;
      }>(nextUrl, expectedPathname);
      if (data.error) break;
      for (const p of (data.data || []).slice(0, MAX_PAGINATION_ROWS - pages.length)) {
        pages.push({
          id: p.id,
          name: p.name,
          picture: p.picture?.data?.url,
        });
      }
      nextUrl = data.paging?.next || null;
      pageCount += 1;
    }

    if (nextUrl) {
      throw new Error("Meta managed-page pagination exceeded its page or row safety cap.");
    }

    return pages;
  }

  /**
   * Get Instagram accounts associated with an ad account.
   */
  async getInstagramAccounts(
    accountId: string,
  ): Promise<
    Array<{ id: string; username: string; profilePicture?: string }>
  > {
    const formattedId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;
    const accounts: Array<{
      id: string;
      username: string;
      profilePicture?: string;
    }> = [];

    try {
      const result = await this.request<{
        data: Array<{
          id: string;
          username?: string;
          profile_picture_url?: string;
        }>;
        paging?: { next?: string };
      }>(`/${formattedId}/instagram_accounts`, {
        fields: "id,username,profile_picture_url",
      });

      for (const a of result.data || []) {
        accounts.push({
          id: a.id,
          username: a.username || a.id,
          profilePicture: a.profile_picture_url,
        });
      }
    } catch {
      // Fallback: return empty array if endpoint fails
    }

    return accounts;
  }

  /**
   * Search for campaigns, ad sets, or ads by name using the Management API.
   * Returns ALL entities regardless of spend/activity (unlike Insights API).
   */
  async searchEntities(
    accountId: string,
    entityType: "campaign" | "adset" | "ad",
    options: {
      nameFilter?: string;
      statusFilter?: string[];
      fields?: string[];
      limit?: number;
    } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const formattedId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;
    const edge =
      entityType === "campaign"
        ? "campaigns"
        : entityType === "adset"
          ? "adsets"
          : "ads";

    // Default fields per entity type
    const defaultFields: Record<string, string[]> = {
      campaign: [
        "name",
        "status",
        "effective_status",
        "objective",
        "daily_budget",
        "lifetime_budget",
        "created_time",
        "updated_time",
      ],
      adset: [
        "name",
        "status",
        "effective_status",
        "campaign_id",
        "daily_budget",
        "lifetime_budget",
        "optimization_goal",
        "billing_event",
        "targeting",
        "created_time",
      ],
      ad: [
        "name",
        "status",
        "effective_status",
        "adset_id",
        "campaign_id",
        "creative{id,name,thumbnail_url}",
        "created_time",
      ],
    };

    const fields = options.fields?.length
      ? options.fields
      : defaultFields[entityType];
    const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_SEARCH_ENTITY_ROWS);

    const params: Record<string, string> = {
      fields: fields!.join(","),
      limit: String(limit),
    };

    // Build filtering
    const filters: Array<{
      field: string;
      operator: string;
      value: string | string[];
    }> = [];
    if (options.nameFilter) {
      filters.push({
        field: "name",
        operator: "CONTAIN",
        value: options.nameFilter,
      });
    }
    if (options.statusFilter?.length) {
      filters.push({
        field: "effective_status",
        operator: "IN",
        value: options.statusFilter,
      });
    }
    if (filters.length > 0) {
      params.filtering = JSON.stringify(filters);
    }

    const results: Array<Record<string, unknown>> = [];
    let nextUrl: string | null = null;
    let pageCount = 1;
    const expectedPathname = `/${this.apiVersion}/${formattedId}/${edge}`;

    const firstPage = await this.request<{
      data: Array<Record<string, unknown>>;
      paging?: { next?: string };
    }>(`/${formattedId}/${edge}`, params);

    results.push(...(firstPage.data || []));
    nextUrl = firstPage.paging?.next || null;

    // Paginate if needed (up to limit)
    while (nextUrl && results.length < limit && pageCount < MAX_PAGINATION_PAGES) {
      const data = await this.fetchPaginatedUrl<{
        data: Array<Record<string, unknown>>;
        paging?: { next?: string };
        error?: MetaApiError;
      }>(nextUrl, expectedPathname);
      if (data.error) break;
      results.push(...(data.data || []));
      nextUrl = data.paging?.next || null;
      pageCount += 1;
    }

    if (nextUrl && results.length < limit && pageCount >= MAX_PAGINATION_PAGES) {
      throw new Error("Meta pagination exceeded the 20-page safety cap.");
    }

    return results.slice(0, limit);
  }

  /**
   * Get an ad preview iframe.
   */
  async getAdPreview(
    adId: string,
    format: string = "DESKTOP_FEED_STANDARD",
  ): Promise<{ body: string }> {
    const response = await this.request<{
      data: Array<{ body: string }>;
    }>(`/${adId}/previews`, { ad_format: format });
    return response.data[0] || { body: "" };
  }

  /**
   * Fetch a single campaign by ID.
   */
  async getCampaign(
    campaignId: string,
  ): Promise<Record<string, unknown>> {
    return this.request(`/${campaignId}`, {
      fields:
        "id,name,status,daily_budget,lifetime_budget,objective,bid_strategy,spend_cap,special_ad_categories",
    });
  }

  /**
   * Fetch a single ad set by ID.
   */
  async getAdSet(adSetId: string): Promise<Record<string, unknown>> {
    return this.request(`/${adSetId}`, {
      fields:
        "id,name,status,daily_budget,lifetime_budget,bid_amount,billing_event,optimization_goal,targeting,start_time,end_time",
    });
  }

  /**
   * Fetch a single ad by ID.
   */
  async getAd(adId: string): Promise<Record<string, unknown>> {
    return this.request(`/${adId}`, {
      fields:
        "id,name,status,effective_status,creative{id,name,object_story_spec,call_to_action_type,link_url,image_url,video_id,thumbnail_url}",
    });
  }

  /**
   * Fetch a single ad creative by ID.
   */
  async getCreative(
    creativeId: string,
  ): Promise<Record<string, unknown>> {
    return this.request(`/${creativeId}`, {
      fields:
        "id,name,object_story_spec,asset_feed_spec,call_to_action_type,link_url,image_url,video_id,thumbnail_url,effective_object_story_id,object_type",
    });
  }

  // ============================================
  // PAGINATION HELPER
  // ============================================

  /**
   * Fetch a full paginated URL (used for "next" page cursors).
   * Rate-limited via the shared limiter.
   */
  private async fetchPaginatedUrl<T>(url: string, expectedPathname: string): Promise<T> {
    const trustedUrl = trustedMetaGraphUrl(url, this.apiVersion, expectedPathname);
    return this.rateLimiter.execute(async () => {
      let response: Response;
      try {
        response = await fetch(trustedUrl, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
          redirect: "error",
        });
      } catch {
        throw new Error("Meta could not be reached while reading the next page.");
      }
      let data: Record<string, unknown> | null = null;
      try { data = await readBoundedJson<Record<string, unknown> | null>(response); }
      catch (error) {
        if (error instanceof ResponseTooLargeError) throw error;
        if (response.ok) throw new Error("Meta returned an unreadable page. Retry from the last cursor.");
      }
      // Callers decide whether an error page stops pagination or fails the
      // read. They receive the provider error with the credential redacted.
      if (!response.ok || (data && typeof data === "object" && data.error)) {
        return { ...(data ?? {}), error: this.safeApiError((data?.error ?? {}) as MetaApiError, response.status) } as T;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Meta returned an invalid page. Retry from the last cursor.");
      }
      return data as T;
    });
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Parse a date range from a date preset string.
 */
export function getDateRangeFromPreset(
  preset: string,
): { since: string; until: string } | null {
  const today = new Date();
  const formatDate = (d: Date): string => d.toISOString().split("T")[0]!;

  switch (preset) {
    case "today":
      return { since: formatDate(today), until: formatDate(today) };

    case "yesterday": {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        since: formatDate(yesterday),
        until: formatDate(yesterday),
      };
    }

    case "last_7d": {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      return { since: formatDate(d), until: formatDate(today) };
    }

    case "last_14d": {
      const d = new Date(today);
      d.setDate(d.getDate() - 14);
      return { since: formatDate(d), until: formatDate(today) };
    }

    case "last_28d": {
      const d = new Date(today);
      d.setDate(d.getDate() - 28);
      return { since: formatDate(d), until: formatDate(today) };
    }

    case "last_30d": {
      const d = new Date(today);
      d.setDate(d.getDate() - 30);
      return { since: formatDate(d), until: formatDate(today) };
    }

    case "last_90d": {
      const d = new Date(today);
      d.setDate(d.getDate() - 90);
      return { since: formatDate(d), until: formatDate(today) };
    }

    case "this_month": {
      const firstOfMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      );
      return {
        since: formatDate(firstOfMonth),
        until: formatDate(today),
      };
    }

    case "last_month": {
      const firstOfLastMonth = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1,
      );
      const lastOfLastMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        0,
      );
      return {
        since: formatDate(firstOfLastMonth),
        until: formatDate(lastOfLastMonth),
      };
    }

    default:
      return null;
  }
}
