/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import type { ToolShape } from "../../tool-quality.js";
import { toMicroCurrency, toMicros, toMinorUnits, toPlainAmount } from "../../core/money.js";
const ADS_BASE = "https://googleads.googleapis.com/v25";
import { registerMetaExtendedWrites, verifyMetaWriteScope } from "./extended-writes.js";
type Handler = (args: Record<string, unknown>) => Promise<unknown>;
type Collector = { tool: (n: string, d: string, s: ToolShape, h: Handler) => void };

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function ko(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/**
 * Toute écriture est un aperçu tant que `confirm` n'est pas vrai.
 *
 * C'est un assistant qui compose ces appels : il peut se tromper de compte, de
 * campagne ou d'ordre de grandeur sur un budget. Un aperçu obligatoire rend
 * l'erreur visible avant qu'elle ne coûte de l'argent, et donne à l'humain le
 * point d'arrêt que le protocole ne garantit pas.
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

async function request(url: string, init: RequestInit, contexte: string): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: "error" });
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  if (!response.ok) {
    if (url.startsWith(ADS_BASE + "/")) {
      const error = (parsed as { error?: { message?: string; details?: { errors?: { errorCode?: unknown; message?: string; location?: unknown }[] }[] } })?.error;
      const details = error?.details?.flatMap(d => d.errors ?? []).map(e => ({ code: e.errorCode, message: e.message, location: e.location }));
      throw new Error(`${contexte}: ${JSON.stringify(details?.length ? details : error?.message ?? parsed).slice(0, 3000)}`);
    }
    throw new Error(`${contexte} : ${typeof parsed === "string" ? parsed.slice(0, 300) : JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

export function registerMetaWrites(c: Collector, config: Record<string, string>): void {
  registerMetaExtendedWrites(c, config);
  const destination = c;
  c = { tool(n,d,s,h) { destination.tool(n,d,s,async raw => {
    try { const a=z.object(s).strict().parse(raw); if(a.confirm) await verifyMetaWriteScope(config,a); return await h(a); }
    catch(e) { return ko((e as Error).message); }
  }); } };
  const version = config.apiVersion || "v26.0";
  const graph = (path: string) => `https://graph.facebook.com/${version}/${path}`;

  const statusTool = (nom: string, target: "campaign" | "ad set" | "ad", param: string) =>
    c.tool(
      nom,
      `Pause or reactivate a Meta ${target}. Previews by default: without confirm: true, ` +
        `the tool describes the change without applying it.`,
      {
        [param]: z.string().describe(`${target} ID.`),
        adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
        status: z.enum(["ACTIVE", "PAUSED"]).describe("ACTIVE reactivates, PAUSED stops delivery."),
        confirm: confirmSchema,
      },
      async (a) => {
        const id = String(a[param]);
        const { status, confirm } = a as Record<string, string | boolean>;
        if (!confirm) return preview(nom, { target: id, newStatus: status });
        const result = await request(
          graph(id),
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ status: String(status), access_token: config.accessToken }),
          },
          `Meta ${target} status`,
        );
        return ok({ applied: true, action: nom, result: result });
      },
    );

  statusTool("meta_update_campaign_status", "campaign", "campaignId");
  statusTool("meta_update_adset_status", "ad set", "adSetId");
  statusTool("meta_update_ad_status", "ad", "adId");

  c.tool(
    "meta_create_campaign",
    "Create a Meta campaign. It is always created PAUSED and there is no option to create " +
      "it active. Previews by default.",
    {
      adAccountId: z.string().describe("Ad account, act_… or bare ID."),
      name: z.string().describe("Name to set. This is the only thing the call changes."),
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
      adsetBudgetSharing: z.boolean().default(false).describe("Explicit ad set budget sharing choice required by Meta. Defaults to false."),
      confirm: confirmSchema,
    },
    async (a) => {
      const { adAccountId, name, objective, specialAdCategories, adsetBudgetSharing, confirm } = a as Record<
        string,
        unknown
      >;
      const act = String(adAccountId).startsWith("act_") ? String(adAccountId) : `act_${adAccountId}`;
      const categories = Array.isArray(specialAdCategories) ? specialAdCategories : [];
      if (!confirm) {
        return preview("meta_create_campaign", { adAccount: act, name, objective, specialAdCategories: categories, adsetBudgetSharing, status: "PAUSED" });
      }
      const result = await request(
        graph(`${act}/campaigns`),
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: String(name),
            objective: String(objective),
            status: "PAUSED",
            special_ad_categories: JSON.stringify(categories),
            is_adset_budget_sharing_enabled: String(adsetBudgetSharing),
            access_token: config.accessToken,
          }),
        },
        "Meta campaign creation",
      );
      return ok({ applied: true, action: "meta_create_campaign", status: "PAUSED", result });
    },
  );

  c.tool(
    "meta_update_adset_budget",
    "Change the daily or lifetime budget of a Meta ad set. Amount in the account currency " +
      "(12.50 for 12.50 EUR). Meta expects minor units, the conversion is done here. " +
      "Previews by default.",
    {
      adSetId: z.string().describe("Ad set ID."),
      adAccountId: z.string().describe("Owning ad account, with or without the act_ prefix."),
      currency: z.string().regex(/^[A-Z]{3}$/).describe("Actual account currency. Required to avoid incorrect unit conversion."),
      dailyBudget: z.number().positive().optional().describe("Daily budget."),
      lifetimeBudget: z.number().positive().optional().describe("Lifetime budget, mutually exclusive with the daily budget."),
      confirm: confirmSchema,
    },
    async (a) => {
      const { adSetId, currency, dailyBudget, lifetimeBudget, confirm } = a as Record<string, string | number | boolean>;
      if (dailyBudget === undefined && lifetimeBudget === undefined) {
        return ko("Provide either dailyBudget or lifetimeBudget.");
      }
      if (dailyBudget !== undefined && lifetimeBudget !== undefined) {
        return ko("dailyBudget and lifetimeBudget are mutually exclusive; Meta rejects both together.");
      }
      const field = dailyBudget !== undefined ? "daily_budget" : "lifetime_budget";
      const minorUnits = toMinorUnits(Number(dailyBudget ?? lifetimeBudget), String(currency));
      if (!confirm) {
        return preview("meta_update_adset_budget", { adSet: adSetId, field, amount: dailyBudget ?? lifetimeBudget, inMinorUnits: minorUnits });
      }
      const result = await request(
        graph(String(adSetId)),
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ [field]: String(minorUnits), access_token: config.accessToken }),
        },
        "Meta budget",
      );
      return ok({ applied: true, action: "meta_update_adset_budget", result: result });
    },
  );

  const renameTool = (nom: string, target: "campaign" | "ad set" | "ad", param: string) =>
    c.tool(
      nom,
      `Rename a Meta ${target}. The name is the only thing that changes. Previews by default.`,
      {
        [param]: z.string().describe(`${target} ID.`),
        adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
        name: z.string().min(1).max(400).describe("New name. This is the only thing the call changes."),
        confirm: confirmSchema,
      },
      async (a) => {
        const id = String(a[param]);
        const { name, confirm } = a as Record<string, string | boolean>;
        if (!confirm) return preview(nom, { target: id, newName: name });
        const result = await request(
          graph(id),
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ name: String(name), access_token: config.accessToken }),
          },
          `Meta ${target} rename`,
        );
        return ok({ applied: true, action: nom, result });
      },
    );

  renameTool("meta_rename_campaign", "campaign", "campaignId");
  renameTool("meta_rename_adset", "ad set", "adSetId");
  renameTool("meta_rename_ad", "ad", "adId");

  c.tool(
    "meta_update_campaign_budget",
    "Change the budget of a Meta campaign that holds its budget at campaign level (Advantage " +
      "campaign budget). On a campaign without one, Meta refuses and the ad set budget is the " +
      "one to change. Amount in the account currency. Previews by default.",
    {
      campaignId: z.string().describe("Campaign ID."),
      adAccountId: z.string().describe("Owning ad account (act_… or bare ID)."),
      currency: z.string().length(3).describe("Account currency code, for example EUR. Read it with meta_get_ad_accounts."),
      dailyBudget: z.number().positive().optional().describe("New daily budget, in the account currency."),
      lifetimeBudget: z.number().positive().optional().describe("New lifetime budget, in the account currency."),
      confirm: confirmSchema,
    },
    async (a) => {
      const { campaignId, currency, dailyBudget, lifetimeBudget, confirm } = a as Record<string, string | number | boolean>;
      if (dailyBudget === undefined && lifetimeBudget === undefined) {
        return ko("Provide either dailyBudget or lifetimeBudget.");
      }
      if (dailyBudget !== undefined && lifetimeBudget !== undefined) {
        return ko("Provide only one of dailyBudget or lifetimeBudget; Meta holds one or the other.");
      }
      const field = dailyBudget !== undefined ? "daily_budget" : "lifetime_budget";
      const amount = Number(dailyBudget ?? lifetimeBudget);
      const minor = toMinorUnits(amount, String(currency));
      if (!confirm) {
        return preview("meta_update_campaign_budget", { campaign: campaignId, field, amount, currency, inMinorUnits: minor });
      }
      const result = await request(
        graph(String(campaignId)),
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ [field]: String(minor), access_token: config.accessToken }),
        },
        "Meta campaign budget",
      );
      return ok({ applied: true, action: "meta_update_campaign_budget", result });
    },
  );

  c.tool(
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
    async (a) => {
      const { adSetId, startTime, endTime, confirm } = a as Record<string, string | boolean>;
      if (!startTime && !endTime) return ko("Provide startTime, endTime, or both.");
      const body: Record<string, string> = { access_token: config.accessToken };
      if (startTime) body.start_time = String(startTime);
      if (endTime) body.end_time = String(endTime);
      if (!confirm) return preview("meta_update_adset_schedule", { adSet: adSetId, startTime, endTime });
      const result = await request(
        graph(String(adSetId)),
        { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) },
        "Meta ad set schedule",
      );
      return ok({ applied: true, action: "meta_update_adset_schedule", result });
    },
  );
}

// ────────────────────────────── TikTok ──────────────────────────────
