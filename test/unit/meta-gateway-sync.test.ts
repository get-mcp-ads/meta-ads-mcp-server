/**
 * Behaviour synchronized from getmcpads revision 3e1c2c8: the ad account
 * rename, promotable apps, website and app creatives, conclusive write
 * refusals, token diagnostics, insights filters and calculated metric fixes.
 * Every provider call is a mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect } from "./catalogue";
import { MetaClient } from "../../src/platforms/meta/client";
import { calculateDerivedMetrics } from "../../src/platforms/meta/calculated-metrics";
import { enrichMetaDimensions } from "../../src/platforms/meta/report-dimensions";
import { readBoundedText, ResponseTooLargeError } from "../../src/core/http";

const TOKEN = "PRIVATE_TOKEN";
const config = { accessToken: TOKEN, apiVersion: "v26.0" };
const tools = () => collect("meta_ads", config);
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await tools().find(t => t.name === name)!.handler(args) as { isError?: boolean; content: { text: string }[] };
  let body: any;
  try { body = JSON.parse(result.content[0].text); } catch { body = result.content[0].text; }
  return { result, body };
};
const run = async (name: string, args: Record<string, unknown>) => (await call(name, args)).body;

type Seen = { url: URL; method: string; body: URLSearchParams; headers: Headers };
let requests: Seen[];
let overrides: Record<string, unknown>;
beforeEach(() => {
  requests = []; overrides = {};
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit = {}) => {
    expect(init.redirect).toBe("error");
    const u = new URL(String(url)), method = init.method || "GET";
    requests.push({ url: u, method, body: new URLSearchParams(init.body as string), headers: new Headers(init.headers) });
    const node = u.pathname.split("/").pop()!;
    const value = (overrides[`${method}:${node}`] as Record<string, unknown> | undefined)
      ?? (method === "POST" ? { id: "900", success: true } : { id: node, account_id: "123", currency: "EUR", campaign_id: "200", status: "PAUSED" });
    return new Response(JSON.stringify(value), { status: value.error ? 400 : 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("meta_rename_ad_account", () => {
  it("is a write tool and previews without any request", async () => {
    expect(tools().find(t => t.name === "meta_rename_ad_account")?.write).toBe(true);
    const body = await run("meta_rename_ad_account", { adAccountId: "act_123", name: "FR_Brand_2026" });
    expect(body).toMatchObject({ applied: false, action: "meta_rename_ad_account", change: { target: "act_123", newName: "FR_Brand_2026" } });
    expect(requests).toHaveLength(0);
  });

  it("verifies the account, then posts the name alone with the token in the header", async () => {
    const body = await run("meta_rename_ad_account", { adAccountId: "123", name: "FR_Brand_2026", confirm: true });
    expect(body).toMatchObject({ applied: true, action: "meta_rename_ad_account" });
    expect(requests[0]).toMatchObject({ method: "GET" });
    expect(requests[0].url.pathname).toBe("/v26.0/act_123");
    const posts = requests.filter(r => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url.toString()).toBe("https://graph.facebook.com/v26.0/act_123");
    expect(Object.fromEntries(posts[0].body)).toEqual({ name: "FR_Brand_2026" });
    expect(posts[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("redacts the token from a provider refusal and does not retry", async () => {
    overrides["POST:act_123"] = { error: { code: 100, message: `Invalid name for token ${TOKEN}` } };
    const { result } = await call("meta_rename_ad_account", { adAccountId: "123", name: "x", confirm: true });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
  });

  it("legacy status and rename writes no longer send the token in the body", async () => {
    await run("meta_rename_campaign", { adAccountId: "123", campaignId: "200", name: "New", confirm: true });
    await run("meta_update_ad_status", { adAccountId: "123", adId: "500", status: "PAUSED", confirm: true });
    for (const post of requests.filter(r => r.method === "POST")) {
      expect(post.body.has("access_token")).toBe(false);
      expect(post.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
  });
});

describe("meta_get_promotable_apps", () => {
  it("is a read and lists advertisable apps with their store URLs only", async () => {
    expect(tools().find(t => t.name === "meta_get_promotable_apps")?.write).toBe(false);
    overrides["GET:advertisable_applications"] = { data: [{ id: "333", name: "Shop app", object_store_urls: { itunes: "https://apps.apple.com/app/id1", google_play: "https://play.google.com/store/apps/details?id=shop", other: "javascript:alert(1)" } }] };
    expect(await run("meta_get_promotable_apps", { adAccountId: "123" })).toEqual({ apps: [{ applicationId: "333", name: "Shop app", objectStoreUrls: ["https://apps.apple.com/app/id1", "https://play.google.com/store/apps/details?id=shop"] }] });
    expect(requests[0].url.pathname).toBe("/v26.0/act_123/advertisable_applications");
  });

  it("explains an unavailable app list instead of reporting no apps as a fact", async () => {
    overrides["GET:advertisable_applications"] = { error: { code: 200, message: "Permission denied" } };
    const body = await run("meta_get_promotable_apps", { adAccountId: "123" });
    expect(body.apps).toEqual([]);
    expect(body.note).toContain("did not return");
  });
});

describe("website and app creatives", () => {
  const OMNI = { omnichannel_object: { app: [{ application_id: "333", custom_event_type: "PURCHASE", object_store_urls: ["https://apps.apple.com/app/id1"] }], pixel: [{ pixel_id: "444", custom_event_type: "PURCHASE" }] } };
  const SPECS = [{ "action.type": ["offsite_conversion"], fb_pixel: ["444"] }, { "action.type": ["mobile_app_install"], application: ["333"] }, { "action.type": ["app_custom_event"], application: ["333"] }];
  const base = { adAccountId: "123", name: "Creative", spec: { object_story_spec: { page_id: "99", link_data: { image_hash: "h", link: "https://example.com/offer" } } } };

  it("accepts applink_treatment and omnichannel_link_spec", async () => {
    const omni = { web: { url: "https://example.com/offer" }, app: { application_id: "333", platform_specs: { android: { url: "shop://offer" } } } };
    const body = await run("meta_create_adcreative", { ...base, spec: { ...base.spec, applink_treatment: "deeplink_with_web_fallback", omnichannel_link_spec: omni } });
    expect(body.payload).toMatchObject({ applink_treatment: "deeplink_with_web_fallback", omnichannel_link_spec: omni });
    expect(requests).toHaveLength(0);
  });

  it.each([
    [{ applink_treatment: "open_app" }, "applink_treatment"],
    [{ omnichannel_link_spec: { web: { url: "https://example.com/offer" } } }, "requires applink_treatment"],
    [{ applink_treatment: "web_only", omnichannel_link_spec: { web: { url: "https://example.com/other" } } }, "must equal the creative link"],
  ])("refuses an invalid web and app creative before any Graph call (%j)", async (patch, message) => {
    const body = await run("meta_create_adcreative", { ...base, spec: { ...base.spec, ...patch }, confirm: true });
    expect(body.error).toContain(message);
    expect(requests).toHaveLength(0);
  });

  it("requires one event across pixel and app in a web and app ad set", async () => {
    const adset = { adAccountId: "123", campaignId: "200", name: "Web and app", currency: "EUR", dailyBudget: 10, configuration: { optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", targeting: { geo_locations: { countries: ["FR"] } }, promoted_object: OMNI } };
    expect((await run("meta_create_adset", adset)).payload.promoted_object).toEqual(OMNI);
    const mixed = { omnichannel_object: { ...OMNI.omnichannel_object, pixel: [{ pixel_id: "444", custom_event_type: "ADD_TO_CART" }] } };
    expect((await run("meta_create_adset", { ...adset, configuration: { ...adset.configuration, promoted_object: mixed } })).error).toContain("same event");
  });

  it("reads what a web and app ad set requires from its own delivering ads", async () => {
    overrides["GET:300"] = { id: "300", account_id: "123", campaign_id: "200", promoted_object: OMNI };
    overrides["GET:ads"] = { data: [
      { id: "700", effective_status: "PAUSED", creative: { id: "800", applink_treatment: "web_only" } },
      { id: "701", effective_status: "ACTIVE", tracking_specs: SPECS, creative: { id: "801", applink_treatment: "deeplink_with_appstore_fallback" } },
    ] };
    const body = await run("meta_get_adset_configuration", { adAccountId: "123", adSetId: "300" });
    expect(body.creativeRequirements).toMatchObject({ crossChannel: true, applicationIds: ["333"], pixelIds: ["444"],
      applinkTreatment: { value: "deeplink_with_appstore_fallback", source: "reference_ad", adId: "701" }, trackingSpecs: { value: SPECS, source: "reference_ad" } });
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });

  it("leaves a website-only ad set read unchanged", async () => {
    overrides["GET:300"] = { id: "300", account_id: "123", campaign_id: "200", promoted_object: { pixel_id: "444", custom_event_type: "PURCHASE" } };
    expect((await run("meta_get_adset_configuration", { adAccountId: "123", adSetId: "300" })).creativeRequirements).toBeUndefined();
  });
});

describe("conclusive and ambiguous write outcomes", () => {
  const ad = { adAccountId: "123", adSetId: "300", creativeId: "400", name: "Reviewed ad" };
  const checkpoint = { code: 31, error_subcode: 3858385, message: `Authenticate this account ${TOKEN}`, fbtrace_id: "Meta_trace-123" };
  function provider(body: unknown, status = 400) {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit = {}) => {
      if ((init.method || "GET") === "GET") return Response.json({ id: "300", account_id: "123" });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }));
  }
  const posts = () => (fetch as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls.filter(([, i]) => i.method === "POST");

  it("reports a security checkpoint as a conclusive refusal with its trace and no token", async () => {
    provider({ error: checkpoint });
    const body = await run("meta_create_ad", { ...ad, confirm: true });
    expect(body).toMatchObject({ applied: false, outcome: "rejected", retrySafe: false, code: 31, subcode: 3858385, httpStatus: 400, fbtrace_id: "Meta_trace-123" });
    expect(body.nextAction).toContain("security authentication");
    expect(body.nextAction).not.toMatch(/launch/i);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(posts()).toHaveLength(1);
  });

  it("names the missing creative field for a web and app ad set refusal", async () => {
    provider({ error: { code: 100, error_subcode: 2446455, message: "applink_treatment is required in ad's creative" } });
    const body = await run("meta_create_ad", { ...ad, confirm: true });
    expect(body).toMatchObject({ applied: false, outcome: "rejected", missingCreativeFields: ["applink_treatment"] });
    expect(body.nextAction).toContain("meta_get_adset_configuration");
    expect(body.nextAction).not.toMatch(/launch/i);
  });

  it.each([
    [{ error: checkpoint }, 500],
    [{ error: checkpoint }, 200],
    [{ error: { ...checkpoint, is_transient: true } }, 400],
    [{ error: checkpoint, id: "native-id" }, 400],
    ["<html>Proxy failed</html>", 502],
    [null, 200],
  ])("never treats an ambiguous response as a safe refusal (%j, HTTP %i)", async (body, status) => {
    provider(body, status as number);
    const result = await run("meta_create_ad", { ...ad, confirm: true });
    expect(result.outcome).toBe("unknown");
    expect(result.retrySafe).toBe(false);
    expect(result.applied).toBeUndefined();
    expect(posts()).toHaveLength(1);
  });

  it.each([{}, { success: false }, { success: true, id: "500" }])("refuses an ambiguous validation success (%j)", async result => {
    provider(result, 200);
    const body = await run("meta_create_ad", { ...ad, validateOnly: true });
    expect(body).toMatchObject({ validatedByMeta: false, outcome: "unknown", retrySafe: false });
  });

  it("drops a trace field that echoes the credential", async () => {
    provider({ error: { ...checkpoint, fbtrace_id: TOKEN } });
    expect((await run("meta_create_ad", { ...ad, confirm: true })).fbtrace_id).toBeUndefined();
  });
});

describe("token diagnostics", () => {
  const allScopes = ["ads_read", "ads_management", "pages_manage_ads", "business_management", "pages_show_list", "pages_read_engagement", "instagram_basic"];
  const valid = { is_valid: true, app_id: "12345", user_id: "67890", type: "SYSTEM_USER", scopes: allScopes, expires_at: 0 };
  const refusal = () => Response.json({ error: { code: 100, type: "OAuthException", message: `You must provide an app access token (${TOKEN})`, fbtrace_id: "trace" } }, { status: 400 });
  function graph(override: (url: URL, init?: RequestInit) => Response | undefined = () => undefined) {
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.has("access_token")).toBe(false);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
      const replaced = override(url, init);
      if (replaced) return replaced;
      if (url.pathname.endsWith("/debug_token")) return Response.json({ data: { ...valid, access_token: TOKEN } });
      if (url.pathname.endsWith("/me/permissions")) return Response.json({ data: allScopes.map(permission => ({ permission, status: "granted" })) });
      if (url.pathname.endsWith("/me/adaccounts")) return Response.json({ data: [{ id: "act_1", account_status: 1 }] });
      if (url.pathname.endsWith("/me")) return Response.json({ id: "67890", name: "Connecting User" });
      throw new Error(`Unexpected path ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("inspects the token with itself through the header and returns only known fields", async () => {
    graph();
    const { result, body } = await call("meta_health_check", {});
    expect(body.status).toBe("ok");
    expect(body.checks.identity).toMatchObject({ source: "debug_token", user_id: "67890", app_id: "12345" });
    expect(body.capabilities.writeSurface).toMatchObject({ adsManagementGranted: true, writesEnabled: true, appAccessLevel: "not_checked" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain("only performs read-only");
  });

  it("falls back to /me and /me/permissions when Meta refuses token inspection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    graph(url => url.pathname.endsWith("/debug_token") ? refusal() : undefined);
    const { result, body } = await call("meta_health_check", {});
    expect(body.status).toBe("degraded");
    expect(body.checks.token).toMatchObject({ ok: false, is_valid: null, status: "unavailable" });
    expect(body.checks.identity).toMatchObject({ ok: true, source: "me", user_id: "67890" });
    expect(body.checks.permissions).toMatchObject({ ok: true, source: "me_permissions", scopes: allScopes });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("keeps grants unknown when inspection and permissions both fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    graph(url => /debug_token|permissions/.test(url.pathname) ? refusal() : undefined);
    const { body } = await call("meta_health_check", {});
    expect(body.capabilities.writeSurface).toMatchObject({ status: "unknown", adsManagementGranted: null });
    expect(body.capabilities.insights.missingRequiredScopes).toBeNull();
    expect(body.warnings.some((w: { message: string }) => w.message.startsWith("Missing required"))).toBe(false);
  });

  it("meta_debug_token returns partial metadata instead of an error after a refusal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    graph(url => url.pathname.endsWith("/debug_token") ? refusal() : undefined);
    const { result, body } = await call("meta_debug_token", {});
    expect(result.isError).not.toBe(true);
    expect(body).toMatchObject({ status: "partial", is_valid: null, user_id: "67890", permissionSource: "me_permissions", scopes: allScopes });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("finishes permission pagination and refuses a foreign next page", async () => {
    graph(url => {
      if (!url.pathname.endsWith("/me/permissions")) return undefined;
      return Response.json(url.searchParams.has("after")
        ? { data: [{ permission: "ads_management", status: "granted" }, { permission: "pages_manage_ads", status: "declined" }] }
        : { data: [{ permission: "ads_read", status: "granted" }], paging: { next: "https://graph.facebook.com/v26.0/me/permissions?after=page2" } });
    });
    expect(await new MetaClient(TOKEN).getGrantedPermissions()).toEqual(["ads_read", "ads_management"]);
    graph(url => url.pathname.endsWith("/me/permissions") ? Response.json({ data: [], paging: { next: "https://unexpected.example/permissions" } }) : undefined);
    await expect(new MetaClient(TOKEN).getGrantedPermissions()).rejects.toThrow("trusted origin");
  });

  it("redacts the token from provider errors and logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    graph(() => Response.json({ error: { code: 190, message: `Bad ${TOKEN}`, error_user_msg: TOKEN } }, { status: 400 }));
    const client = new MetaClient(TOKEN);
    await expect(client.getAdAccounts()).rejects.toThrow("[redacted]");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("does not expose the token from transport or parse failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`connect failed input_token=${TOKEN}`)));
    await expect(new MetaClient(TOKEN).debugToken()).rejects.toThrow("could not be reached");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`not json ${TOKEN}`)));
    await expect(new MetaClient(TOKEN).debugToken()).rejects.toThrow(/unreadable/);
  });
});

describe("meta_get_insights", () => {
  const insights = (rows: Record<string, unknown>[]) => { overrides["GET:insights"] = { data: rows }; };
  const base = { adAccountId: "act_123", level: "campaign", metrics: ["spend"], timeRange: { since: "2026-09-01", until: "2026-09-07" } };

  it("sends campaign, ad set and status filters as native filtering", async () => {
    insights([{ campaign_id: "1", spend: "10" }]);
    await run("meta_get_insights", { ...base, level: "ad", campaignIds: ["1"], adsetIds: ["2"], effectiveStatus: "ACTIVE" });
    const filtering = JSON.parse(requests.find(r => r.url.pathname.endsWith("/insights"))!.url.searchParams.get("filtering")!);
    expect(filtering).toEqual([
      { field: "adset.id", operator: "IN", value: ["2"] },
      { field: "campaign.id", operator: "IN", value: ["1"] },
      { field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] },
    ]);
  });

  it.each([
    [{ level: "account", campaignIds: ["1"] }, "campaignIds"],
    [{ level: "campaign", adsetIds: ["1"] }, "adsetIds"],
    [{ level: "account", effectiveStatus: "ACTIVE" }, "effectiveStatus"],
  ])("refuses an inconsistent filter before any request (%j)", async (patch, message) => {
    const { result } = await call("meta_get_insights", { ...base, ...patch });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(message);
    expect(requests).toHaveLength(0);
  });

  it("adds the action arrays needed to read conversions and says so", async () => {
    insights([{ campaign_id: "1", spend: "10", conversions: [] }]);
    const body = await run("meta_get_insights", { ...base, metrics: ["spend", "conversions"] });
    expect(body.metric_selection).toEqual({ requested: ["spend", "conversions"], supporting_metrics_added: ["actions"] });
    const fields = requests.filter(r => r.url.pathname.endsWith("/insights")).flatMap(r => r.url.searchParams.get("fields")!.split(","));
    expect(fields).toContain("actions");
  });

  it("refuses share metrics on a segmented report", async () => {
    insights([{ campaign_id: "1", spend: "10", age: "18-24" }]);
    const { result } = await call("meta_get_insights", { ...base, metrics: ["spend", "spendShare"], breakdowns: ["age"] });
    expect(JSON.stringify(result)).toContain("Share metrics require an unsegmented report");
  });

  it("batches entity metadata within the selected account", async () => {
    const rows = await enrichMetaDimensions([{ ad_id: "1" }, { ad_id: "2" }], ["creative_name", "ad_effective_status"], "ad", "act_123", async (path, args) => {
      expect(path).toBe("/act_123/ads");
      expect(JSON.parse(String(args.filtering))[0].value).toEqual(["1", "2"]);
      return { data: [{ id: "1", effective_status: "ACTIVE", creative: { name: "Blue" } }, { id: "2", effective_status: "PAUSED", creative: { name: "Red" } }] };
    });
    expect(rows).toEqual([{ ad_id: "1", creative_name: "Blue", ad_effective_status: "ACTIVE" }, { ad_id: "2", creative_name: "Red", ad_effective_status: "PAUSED" }]);
  });
});

describe("calculated metric fixes", () => {
  const actions = (values: Record<string, number>) => Object.entries(values).map(([action_type, value]) => ({ action_type, value: String(value) }));
  const row = (extra: Record<string, unknown> = {}) => ({
    spend: "120", impressions: "1000",
    actions: actions({ omni_purchase: 6, "offsite_conversion.fb_pixel_purchase": 2, "app_custom_event.fb_mobile_purchase": 3, link_click: 60 }),
    action_values: actions({ omni_purchase: 900, "offsite_conversion.fb_pixel_purchase": 100, "app_custom_event.fb_mobile_purchase": 120 }),
    ...extra,
  }) as never;

  it("keeps website and app averages on their own purchase events", () => {
    const result = calculateDerivedMetrics(row());
    expect(result.aov).toBe(150);
    expect(result.aovWebsite).toBe(50);
    expect(result.aovApp).toBe(40);
    expect(result.clickToWebsitePurchaseRatio).toBeCloseTo(100 / 30);
  });

  it("reports zero revenue as zero and missing revenue as missing", () => {
    expect(calculateDerivedMetrics(row({ action_values: [] })).leadsRoas).toBe(0);
    expect(calculateDerivedMetrics(row({ action_values: undefined })).leadsRoas).toBeUndefined();
    expect(calculateDerivedMetrics(row({ action_values: undefined })).subscriptionRoas).toBeUndefined();
  });
});

describe("bounded responses", () => {
  it("refuses a body larger than the limit", async () => {
    await expect(readBoundedText(new Response("x".repeat(64)), 32)).rejects.toBeInstanceOf(ResponseTooLargeError);
    await expect(readBoundedText(new Response("x".repeat(16)), 32)).resolves.toBe("x".repeat(16));
  });

  it("refuses a declared length above the limit before reading", async () => {
    const response = new Response("{}", { headers: { "content-length": String(100 * 1024 * 1024) } });
    await expect(readBoundedText(response)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });
});
