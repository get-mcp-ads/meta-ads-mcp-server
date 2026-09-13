import { registerMetaExtendedWrites } from "./extended-writes.js";
/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetaConfig } from "../../config/types.js";
import { registerMetaTools } from "./tools.js";
import { registerMetaResources } from "./resources.js";
import { registerMetaWrites } from "./writes.js";
import { logger } from "../../core/logger.js";

export function registerMeta(server: McpServer, config: MetaConfig): void {
  registerMetaTools(server, config);
  registerMetaExtendedWrites(server as never, config as never, true);
  registerMetaResources(server, config.enableWrites ?? false);
  logger.info("meta", "Registered 39 read tools and 7 resources");

  if (config.enableWrites) {
    registerMetaWrites(server as never, config as never);
    logger.info("meta", "Registered 23 write tools (every one previews before it applies)");
  }
}
