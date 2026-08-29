/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";

const metaSchema = z.object({
  accessToken: z.string().min(1),
  apiVersion: z.string().optional(),
  enableWrites: z.boolean().optional(),
});

export const serverConfigSchema = z.object({
  meta: metaSchema.optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ValidatedConfig = z.infer<typeof serverConfigSchema>;
