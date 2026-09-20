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




}

// ────────────────────────────── TikTok ──────────────────────────────
