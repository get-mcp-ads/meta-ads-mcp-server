/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import type { ToolShape } from "../../tool-quality.js";
import { readBoundedText } from "../../core/http.js";
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
 * Every write is a preview until `confirm` is true.
 *
 * An assistant composes these calls: it can pick the wrong account, the wrong
 * campaign or the wrong order of magnitude on a budget. A mandatory preview
 * makes the mistake visible before it costs money, and gives a human the
 * stopping point the protocol does not guarantee.
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
 * One Graph mutation, never retried. A transport failure or a server error
 * leaves the outcome unknown: the message says so, so the caller reads the
 * object before trying again.
 */
async function request(url: string, init: RequestInit, context: string, accessToken: string): Promise<unknown> {
  const redact = (text: string) => text.replaceAll(accessToken, "[redacted]");
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), redirect: "error" });
  } catch {
    throw new Error(`${context}: Meta could not be reached or did not answer in time. The outcome is unknown; read the object before retrying.`);
  }
  let body: string;
  try {
    body = await readBoundedText(response);
  } catch {
    throw new Error(`${context}: Meta returned an unreadable response. The outcome is unknown; read the object before retrying.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  const error = parsed && typeof parsed === "object" ? (parsed as { error?: unknown }).error : undefined;
  if (!response.ok || error) {
    const detail = typeof parsed === "string" ? parsed.slice(0, 300) : JSON.stringify(error ?? parsed).slice(0, 300);
    const outcome = response.status >= 500 ? " The outcome is unknown; read the object before retrying." : "";
    throw new Error(redact(`${context}: ${detail}${outcome}`));
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
            headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${config.accessToken}` },
            body: new URLSearchParams({ status: String(status) }),
          },
          `Meta ${target} status`,
          config.accessToken,
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
            headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${config.accessToken}` },
            body: new URLSearchParams({ name: String(name) }),
          },
          `Meta ${target} rename`,
          config.accessToken,
        );
        return ok({ applied: true, action: nom, result });
      },
    );

  renameTool("meta_rename_campaign", "campaign", "campaignId");
  renameTool("meta_rename_adset", "ad set", "adSetId");
  renameTool("meta_rename_ad", "ad", "adId");

  c.tool(
    "meta_rename_ad_account",
    "Rename a Meta ad account. The name is the only thing that changes. Previews by default.",
    {
      adAccountId: z.string().describe("Ad account to rename (act_… or bare ID)."),
      name: z.string().min(1).max(400).describe("New name. This is the only thing the call changes."),
      confirm: confirmSchema,
    },
    async (a) => {
      const account = `act_${String(a.adAccountId).replace(/^act_/, "")}`;
      const { name, confirm } = a as Record<string, string | boolean>;
      if (!confirm) return preview("meta_rename_ad_account", { target: account, newName: name });
      const result = await request(
        graph(account),
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${config.accessToken}` },
          body: new URLSearchParams({ name: String(name) }),
        },
        "Meta ad account rename",
        config.accessToken,
      );
      return ok({ applied: true, action: "meta_rename_ad_account", result });
    },
  );
}
