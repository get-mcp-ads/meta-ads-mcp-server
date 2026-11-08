/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
// Public API for programmatic usage
export { createServer, PACKAGE_VERSION } from "./server.js";
export { loadConfig } from "./config/index.js";
export { startStdioTransport } from "./transports/stdio.js";
export type { ServerConfig, MetaConfig } from "./config/types.js";
