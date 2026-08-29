#!/usr/bin/env node
/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { loadConfig } from "./config/index.js";
import { createServer } from "./server.js";
import { startStdioTransport } from "./transports/stdio.js";
import { logger } from "./core/logger.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    logger.setLevel(config.logLevel);

    const server = createServer(config);
    await startStdioTransport(server);
  } catch (error) {
    logger.error("cli", "Fatal error", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
