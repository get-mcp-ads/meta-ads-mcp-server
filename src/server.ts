/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config/types.js";
import { registerMeta } from "./platforms/meta/index.js";
import { logger } from "./core/logger.js";

export const PACKAGE_VERSION = "1.0.2";

/**
 * Create and configure the MCP server.
 */
export function createServer(config: ServerConfig): McpServer {
  const server = new McpServer(
    {
      name: "meta-ads-mcp",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
      },
    },
  );

  if (config.meta) {
    registerMeta(server, config.meta);
    logger.system(
      `meta-ads-mcp v${PACKAGE_VERSION} ready, writes ${
        config.meta.enableWrites ? "enabled" : "disabled"
      }`,
    );
  } else {
    logger.system(`meta-ads-mcp v${PACKAGE_VERSION} ready, no credentials set, no tools exposed`);
  }

  return server;
}
