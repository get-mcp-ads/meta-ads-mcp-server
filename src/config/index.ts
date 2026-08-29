/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { serverConfigSchema } from "./schema.js";
import type { ServerConfig } from "./types.js";
import { logger } from "../core/logger.js";

/**
 * Load configuration from environment variables.
 *
 * `META_ACCESS_TOKEN` is the only required variable. Everything else is
 * optional and has a sensible default.
 */
export function loadConfig(): ServerConfig {
  const env = process.env;

  const raw: Record<string, unknown> = {
    logLevel: env["LOG_LEVEL"] ?? "info",
  };

  if (env["META_ACCESS_TOKEN"]) {
    raw.meta = {
      accessToken: env["META_ACCESS_TOKEN"],
      ...(env["META_API_VERSION"] && { apiVersion: env["META_API_VERSION"] }),
      enableWrites: isTruthy(env["META_ENABLE_WRITES"]),
    };
  }

  const result = serverConfigSchema.safeParse(raw);
  if (!result.success) {
    logger.error("config", "Invalid configuration", result.error.flatten());
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  const config = result.data as ServerConfig;

  if (!config.meta) {
    logger.warn(
      "config",
      "META_ACCESS_TOKEN is not set. The server will start but expose no tools.",
    );
  }

  return config;
}

/** Accepts the spellings people actually type in an MCP client config. */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export type { ServerConfig } from "./types.js";
