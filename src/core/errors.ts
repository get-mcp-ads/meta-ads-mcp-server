/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Platform } from "./types.js";

/**
 * Base error for all platform API errors.
 * Provides structured error information for MCP tool responses.
 */
export class PlatformApiError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly code: number,
    message: string,
    public readonly isRateLimit: boolean = false,
    public readonly isAuth: boolean = false,
    public readonly isPermission: boolean = false,
    public readonly suggestion: string = "",
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }

  toMcpError() {
    return {
      error: this.message,
      platform: this.platform,
      code: this.code,
      isRateLimit: this.isRateLimit,
      isAuth: this.isAuth,
      isPermission: this.isPermission,
      suggestion: this.suggestion,
      ...(this.retryAfter !== undefined && { retryAfter: this.retryAfter }),
    };
  }
}

export class RateLimitError extends PlatformApiError {
  constructor(platform: Platform, retryAfter?: number) {
    super(
      platform,
      429,
      `Rate limit exceeded for ${platform}`,
      true,
      false,
      false,
      retryAfter
        ? `Wait ${retryAfter} seconds and retry`
        : "Wait and retry with exponential backoff",
      retryAfter,
    );
    this.name = "RateLimitError";
  }
}

export class AuthError extends PlatformApiError {
  constructor(platform: Platform, message?: string) {
    super(
      platform,
      401,
      message ?? `Authentication failed for ${platform}. Check your access token.`,
      false,
      true,
      false,
      `Verify your ${platform.toUpperCase()} access token is valid and has the required scopes`,
    );
    this.name = "AuthError";
  }
}

export class PermissionError extends PlatformApiError {
  constructor(platform: Platform, message?: string) {
    super(
      platform,
      403,
      message ?? `Insufficient permissions for ${platform}`,
      false,
      false,
      true,
      `Ensure your token has the required read-only scopes for ${platform}`,
    );
    this.name = "PermissionError";
  }
}

/**
 * Format a PlatformApiError as an MCP tool error response.
 */
export function formatMcpToolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof PlatformApiError) {
    return {
      content: [{ type: "text", text: JSON.stringify(error.toMcpError(), null, 2) }],
      isError: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, suggestion: "Check the error details and retry" }, null, 2),
      },
    ],
    isError: true,
  };
}
