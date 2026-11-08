/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
export interface MetaConfig {
  accessToken: string;
  apiVersion?: string;
  /**
   * Write tools are registered only when this is true.
   * Reading needs `ads_read`; writing needs `ads_management`.
   */
  enableWrites?: boolean;
}

export interface ServerConfig {
  meta?: MetaConfig;
  logLevel: "debug" | "info" | "warn" | "error";
}
