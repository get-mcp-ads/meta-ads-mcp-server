/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Write tools for the Meta Marketing API.
 *
 * These are registered only when `META_ENABLE_WRITES` is set. Reading needs the
 * `ads_read` permission; everything in this file needs `ads_management`.
 *
 * Part of meta-ads-mcp-server: https://github.com/getmcpads-com/meta-ads-mcp-server
 * Managed, multi-platform version: https://www.getmcpads.com
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetaConfig } from "../../config/types.js";
import { DEFAULT_API_VERSION } from "./client.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function ko(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/**
 * Every write is a preview until `confirm` is true.
 *
 * An assistant composes these calls, and it can pick the wrong account, the
 * wrong campaign, or the wrong order of magnitude on a budget. A mandatory
 * preview makes the mistake visible before it costs money, and gives a human
 * the stopping point the protocol does not guarantee on its own.
 */
function preview(action: string, details: Record<string, unknown>) {
  return ok({
    applied: false,
    action,
    change: details,
    message:
      "Preview only, nothing was changed. Repeat the same call with confirm: true " +
      "to apply this change to the live account.",
  });
}

const confirmSchema = z
  .boolean()
  .optional()
  .describe("Set to true to actually apply the change. Without it, the tool only previews.");

/**
 * Meta expects budgets in minor units, and the factor depends on the currency.
 * The yen and the won have no subunit, so sending 1250 for 12.50 there would
 * multiply the spend by a hundred.
 */
const ZERO_DECIMAL = new Set([
  "JPY", "KRW", "CLP", "ISK", "VND", "UGX", "PYG", "RWF", "XOF",
  "XAF", "XPF", "BIF", "DJF", "GNF", "KMF", "MGA", "VUV",
]);

export function toMinorUnits(amount: number, currency: string): number {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Expected a three letter currency code, received "${currency}".`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Expected a positive amount, received "${amount}".`);
  }
  return Math.round(amount * (ZERO_DECIMAL.has(code) ? 1 : 100));
}

async function request(url: string, init: RequestInit, context: string): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    throw new Error(`${context}: ${detail.slice(0, 300)}`);
  }
  return parsed;
}

export function registerMetaWrites(server: McpServer, config: MetaConfig): void {
  const version = config.apiVersion || DEFAULT_API_VERSION;
  const graph = (path: string) => `https://graph.facebook.com/${version}/${path}`;
  const form = (fields: Record<string, string>) => ({
    method: "POST" as const,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: config.accessToken }),
  });

  // ── Status: pause / reactivate ────────────────────────────────────
  const statusTool = (name: string, target: "campaign" | "ad set" | "ad", param: string) =>
    server.tool(
      name,
      `Pause or reactivate a Meta ${target}. Previews by default: without confirm: true, ` +
        `the tool describes the change without applying it.`,
      {
        [param]: z.string().describe(`${target} ID.`),
        adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
        status: z.enum(["ACTIVE", "PAUSED"]).describe("ACTIVE reactivates, PAUSED stops delivery."),
        confirm: confirmSchema,
      },
      async (a: Record<string, unknown>) => {
        const id = String(a[param]);
        const { status, confirm } = a as Record<string, string | boolean>;
        if (!confirm) return preview(name, { target: id, newStatus: status });
        const result = await request(graph(id), form({ status: String(status) }), `Meta ${target} status`);
        return ok({ applied: true, action: name, result });
      },
    );

  statusTool("meta_update_campaign_status", "campaign", "campaignId");
  statusTool("meta_update_adset_status", "ad set", "adSetId");
  statusTool("meta_update_ad_status", "ad", "adId");

  // ── Rename ────────────────────────────────────────────────────────
  const renameTool = (name: string, target: "campaign" | "ad set" | "ad", param: string) =>
    server.tool(
      name,
      `Rename a Meta ${target}. The name is the only thing that changes. Previews by default.`,
      {
        [param]: z.string().describe(`${target} ID.`),
        adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
        name: z.string().min(1).max(400).describe("New name. This is the only thing the call changes."),
        confirm: confirmSchema,
      },
      async (a: Record<string, unknown>) => {
        const id = String(a[param]);
        const { name: newName, confirm } = a as Record<string, string | boolean>;
        if (!confirm) return preview(name, { target: id, newName });
        const result = await request(graph(id), form({ name: String(newName) }), `Meta ${target} rename`);
        return ok({ applied: true, action: name, result });
      },
    );

  renameTool("meta_rename_campaign", "campaign", "campaignId");
  renameTool("meta_rename_adset", "ad set", "adSetId");
  renameTool("meta_rename_ad", "ad", "adId");

  // ── Create campaign (always paused) ───────────────────────────────
  server.tool(
    "meta_create_campaign",
    "Create a Meta campaign. It is always created PAUSED and there is no option to create " +
      "it active. Previews by default.",
    {
      adAccountId: z.string().describe("Ad account, act_… or bare ID."),
      name: z.string().min(1).max(400).describe("Campaign name."),
      objective: z
        .enum([
          "OUTCOME_TRAFFIC",
          "OUTCOME_SALES",
          "OUTCOME_LEADS",
          "OUTCOME_AWARENESS",
          "OUTCOME_ENGAGEMENT",
          "OUTCOME_APP_PROMOTION",
        ])
        .describe("Campaign objective."),
      specialAdCategories: z
        .array(z.enum(["NONE", "HOUSING", "EMPLOYMENT", "CREDIT", "ISSUES_ELECTIONS_POLITICS"]))
        .optional()
        .describe("Required by Meta. Defaults to none."),
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const { adAccountId, name, objective, specialAdCategories, confirm } = a;
      const act = String(adAccountId).startsWith("act_") ? String(adAccountId) : `act_${adAccountId}`;
      const categories = Array.isArray(specialAdCategories) ? specialAdCategories : [];
      if (!confirm) {
        return preview("meta_create_campaign", {
          adAccount: act, name, objective, specialAdCategories: categories, status: "PAUSED",
        });
      }
      const result = await request(
        graph(`${act}/campaigns`),
        form({
          name: String(name),
          objective: String(objective),
          status: "PAUSED",
          special_ad_categories: JSON.stringify(categories),
        }),
        "Meta campaign creation",
      );
      return ok({ applied: true, action: "meta_create_campaign", status: "PAUSED", result });
    },
  );

  // ── Budgets ───────────────────────────────────────────────────────
  server.tool(
    "meta_update_adset_budget",
    "Change the daily or lifetime budget of a Meta ad set. Amount in the account currency " +
      "(12.50 for 12.50 EUR). Meta expects minor units, the conversion is done here. " +
      "Previews by default.",
    {
      adSetId: z.string().describe("Ad set ID."),
      adAccountId: z.string().describe("Owning ad account, with or without the act_ prefix."),
      currency: z.string().length(3).describe("Account currency code, for example EUR. Read it with meta_list_ad_accounts."),
      dailyBudget: z.number().positive().optional().describe("Daily budget, in the account currency."),
      lifetimeBudget: z.number().positive().optional().describe("Lifetime budget, mutually exclusive with the daily budget."),
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const { adSetId, currency, dailyBudget, lifetimeBudget, confirm } = a;
      if (dailyBudget === undefined && lifetimeBudget === undefined) {
        return ko("Provide either dailyBudget or lifetimeBudget.");
      }
      if (dailyBudget !== undefined && lifetimeBudget !== undefined) {
        return ko("dailyBudget and lifetimeBudget are mutually exclusive; Meta rejects both together.");
      }
      const field = dailyBudget !== undefined ? "daily_budget" : "lifetime_budget";
      const amount = Number(dailyBudget ?? lifetimeBudget);
      let minor: number;
      try {
        minor = toMinorUnits(amount, String(currency));
      } catch (error) {
        return ko(error instanceof Error ? error.message : String(error));
      }
      if (!confirm) {
        return preview("meta_update_adset_budget", {
          adSet: adSetId, field, amount, currency, inMinorUnits: minor,
        });
      }
      const result = await request(graph(String(adSetId)), form({ [field]: String(minor) }), "Meta ad set budget");
      return ok({ applied: true, action: "meta_update_adset_budget", result });
    },
  );

  server.tool(
    "meta_update_campaign_budget",
    "Change the budget of a Meta campaign that holds its budget at campaign level (Advantage " +
      "campaign budget). On a campaign without one, Meta refuses and the ad set budget is the " +
      "one to change. Amount in the account currency. Previews by default.",
    {
      campaignId: z.string().describe("Campaign ID."),
      adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
      currency: z.string().length(3).describe("Account currency code, for example EUR. Read it with meta_list_ad_accounts."),
      dailyBudget: z.number().positive().optional().describe("New daily budget, in the account currency."),
      lifetimeBudget: z.number().positive().optional().describe("New lifetime budget, in the account currency."),
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const { campaignId, currency, dailyBudget, lifetimeBudget, confirm } = a;
      if (dailyBudget === undefined && lifetimeBudget === undefined) {
        return ko("Provide either dailyBudget or lifetimeBudget.");
      }
      if (dailyBudget !== undefined && lifetimeBudget !== undefined) {
        return ko("Provide only one of dailyBudget or lifetimeBudget; Meta holds one or the other.");
      }
      const field = dailyBudget !== undefined ? "daily_budget" : "lifetime_budget";
      const amount = Number(dailyBudget ?? lifetimeBudget);
      let minor: number;
      try {
        minor = toMinorUnits(amount, String(currency));
      } catch (error) {
        return ko(error instanceof Error ? error.message : String(error));
      }
      if (!confirm) {
        return preview("meta_update_campaign_budget", {
          campaign: campaignId, field, amount, currency, inMinorUnits: minor,
        });
      }
      const result = await request(graph(String(campaignId)), form({ [field]: String(minor) }), "Meta campaign budget");
      return ok({ applied: true, action: "meta_update_campaign_budget", result });
    },
  );

  // ── Schedule ──────────────────────────────────────────────────────
  server.tool(
    "meta_update_adset_schedule",
    "Change the start or end time of a Meta ad set. Times are ISO 8601 with an offset, for " +
      "example 2026-09-01T00:00:00+0200. Previews by default.",
    {
      adSetId: z.string().describe("Ad set ID."),
      adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
      startTime: z.string().optional().describe("Start time, ISO 8601 with an offset, for example 2026-09-01T00:00:00+0200."),
      endTime: z.string().optional().describe("End time, ISO 8601 with an offset, for example 2026-09-30T23:59:59+0200."),
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const { adSetId, startTime, endTime, confirm } = a as Record<string, string | boolean>;
      if (!startTime && !endTime) return ko("Provide startTime, endTime, or both.");
      const fields: Record<string, string> = {};
      if (startTime) fields.start_time = String(startTime);
      if (endTime) fields.end_time = String(endTime);
      if (!confirm) return preview("meta_update_adset_schedule", { adSet: adSetId, startTime, endTime });
      const result = await request(graph(String(adSetId)), form(fields), "Meta ad set schedule");
      return ok({ applied: true, action: "meta_update_adset_schedule", result });
    },
  );
}
