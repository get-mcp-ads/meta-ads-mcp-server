/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env["LOG_LEVEL"] as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function log(level: LogLevel, platform: string | null, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    ...(platform && { platform }),
    msg: message,
    ...(data !== undefined && { data }),
  };

  // MCP servers must only write protocol messages to stdout.
  // All logs go to stderr.
  console.error(JSON.stringify(entry));
}

export const logger = {
  debug: (platform: string, msg: string, data?: unknown) => log("debug", platform, msg, data),
  info: (platform: string, msg: string, data?: unknown) => log("info", platform, msg, data),
  warn: (platform: string, msg: string, data?: unknown) => log("warn", platform, msg, data),
  error: (platform: string, msg: string, data?: unknown) => log("error", platform, msg, data),
  system: (msg: string, data?: unknown) => log("info", null, msg, data),
  setLevel: (level: LogLevel) => {
    currentLevel = level;
  },
};
