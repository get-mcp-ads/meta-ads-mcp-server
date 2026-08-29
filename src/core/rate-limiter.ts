/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Platform } from "./types.js";
import { RateLimitError } from "./errors.js";
import { logger } from "./logger.js";

interface RateLimitConfig {
  /** Max requests per second */
  maxPerSecond: number;
  /** Max requests per minute */
  maxPerMinute: number;
  /** Max retry attempts */
  maxRetries: number;
}

const PLATFORM_LIMITS: Record<Platform, RateLimitConfig> = {
  meta: { maxPerSecond: 3, maxPerMinute: 200, maxRetries: 3 },
};

interface RequestRecord {
  timestamps: number[];
}

/**
 * Per-platform rate limiter with exponential backoff.
 * Tracks request timestamps and enforces rate limits before sending.
 */
export class RateLimiter {
  private records = new Map<string, RequestRecord>();
  private config: RateLimitConfig;

  constructor(private platform: Platform) {
    this.config = PLATFORM_LIMITS[platform];
  }

  /**
   * Wait until a request is safe to send, respecting rate limits.
   * Throws RateLimitError if all retries are exhausted.
   */
  async acquire(): Promise<void> {
    const key = this.platform;
    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    const now = Date.now();

    // Clean old timestamps (older than 60s)
    record.timestamps = record.timestamps.filter((t) => now - t < 60_000);

    // Check per-second limit
    const lastSecond = record.timestamps.filter((t) => now - t < 1000);
    if (lastSecond.length >= this.config.maxPerSecond) {
      const waitMs = 1000 - (now - lastSecond[0]!) + 50;
      logger.debug(this.platform, `Rate limit: waiting ${waitMs}ms (per-second limit)`);
      await sleep(waitMs);
    }

    // Check per-minute limit
    if (record.timestamps.length >= this.config.maxPerMinute) {
      const waitMs = 60_000 - (now - record.timestamps[0]!) + 100;
      logger.warn(this.platform, `Rate limit: waiting ${waitMs}ms (per-minute limit)`);
      await sleep(waitMs);
    }

    record.timestamps.push(Date.now());
  }

  /**
   * Execute a function with automatic rate limiting and retry on 429.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      await this.acquire();

      try {
        return await fn();
      } catch (error) {
        if (isRateLimitError(error) && attempt < this.config.maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt) + jitter(), 30_000);
          logger.warn(
            this.platform,
            `Rate limited (attempt ${attempt + 1}/${this.config.maxRetries}), retrying in ${backoff}ms`,
          );
          await sleep(backoff);
          continue;
        }
        throw error;
      }
    }

    throw new RateLimitError(this.platform);
  }
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("rate limit") || msg.includes("too many requests");
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
  return Math.floor(Math.random() * 500);
}
