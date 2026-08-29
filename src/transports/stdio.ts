/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../core/logger.js";

/**
 * Connect the MCP server to stdio transport (for Claude Desktop, Claude Code, Cursor).
 */
export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  logger.system("Starting stdio transport...");
  await server.connect(transport);
  logger.system("Stdio transport connected, waiting for MCP client");
}
