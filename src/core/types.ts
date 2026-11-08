/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Shared type definitions used across the server.
 */

export type Platform = "meta";

export interface MetricDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  format: "number" | "currency" | "percentage" | "string" | "duration";
  isCalculated?: boolean;
  /** Base metrics required to compute this calculated metric */
  dependsOn?: string[];
}

export interface DimensionDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
}

export interface BreakdownDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
}

export interface FilterDefinition {
  key: string;
  name: string;
  description: string;
  operators: string[];
  valueType: "string" | "number" | "enum" | "date";
  enumValues?: string[];
}

export interface CompatibilityResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface QueryPlan {
  queries: QueryPlanItem[];
  joinKeys: string[];
}

export interface QueryPlanItem {
  metrics: string[];
  dimensions: string[];
  filters?: Record<string, unknown>;
}

export interface InsightRow {
  [key: string]: string | number | null;
}

export interface InsightResult {
  data: InsightRow[];
  rowCount: number;
  debug: {
    requestCount: number;
    executionTimeMs: number;
    warnings: string[];
  };
}

export interface PlatformStatus {
  platform: Platform;
  configured: boolean;
  authenticated: boolean;
  error?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor?: string;
  totalEstimate?: number;
}
