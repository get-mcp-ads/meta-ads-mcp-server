import { afterEach, describe, expect, it, vi } from "vitest";
import { collect } from "./catalogue";

afterEach(() => vi.unstubAllGlobals());
const invoke = async (args: Record<string, unknown>) => {
  const tool = collect("meta_ads", { accessToken: "test-secret" }).find(t => t.name === "meta_get_creatives")!;
  const result = await tool.handler(args) as {content: {text: string}[]; isError?: boolean};
  return { result, payload: JSON.parse(result.content[0].text) };
};

describe("Meta v26 exact-ad creative reads", () => {
  it("uses account-scoped filters, chunks IDs and preserves ID-keyed output", async () => {
    const ids = Array.from({length: 51}, (_, i) => String(1000 + i));
    const requested: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)); requested.push(url);
      expect(url.pathname).toBe("/v26.0/act_123/ads");
      expect(url.searchParams.has("ids")).toBe(false);
      expect(url.searchParams.has("access_token")).toBe(false);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-secret");
      const selected = JSON.parse(url.searchParams.get("filtering")!)[0].value as string[];
      expect(selected.length).toBeLessThanOrEqual(50);
      return Response.json({data: selected.map(id => ({id, account_id: "123", creative: {id: `c${id}`}}))});
    }));
    const {payload} = await invoke({adAccountId: "123", adIds: [...ids, ids[0]], limit: 100});
    expect(requested).toHaveLength(2);
    expect(ids.every(id => payload[id]?.creative.id === `c${id}`)).toBe(true);
    expect(payload.warnings).toEqual([]);
    expect(payload.debug.requestCount).toBe(2);
  });

  it("recovers historical ads but never returns another account's ad", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/ads")) return Response.json({data: []});
      const id = url.pathname.split("/").at(-1);
      return Response.json({id, account_id: id === "111" ? "123" : "999", name: id === "111" ? "Historical" : "Other client"});
    }));
    const {payload, result} = await invoke({adAccountId: "act_123", adIds: ["111", "222"], limit: 100});
    expect(payload["111"].name).toBe("Historical");
    expect(payload["222"]).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Other client");
    expect(payload.warnings[0].message).toContain("1 requested ads");
    expect(payload.debug.requestCount).toBe(3);
  });

  it("reports inaccessible historical ads without inventing successful metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith("/ads")
      ? Response.json({data: []})
      : Response.json({error: {message: "Ad unavailable", code: 100}}, {status: 400})));
    const {payload} = await invoke({adAccountId: "123", adIds: ["111"], limit: 100});
    expect(payload["111"]).toBeUndefined();
    expect(payload.warnings.some((w: {message: string}) => w.message.includes("Ad unavailable"))).toBe(true);
    expect(payload.debug.requestCount).toBe(2);
  });

  it("rejects invalid IDs before reaching Meta", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const {result} = await invoke({adAccountId: "123", adIds: ["../me"], limit: 100});
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the paginated account listing when IDs are omitted", async () => {
    const body = {data: [{id: "111"}], paging: {cursors: {after: "next"}}};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v26.0/act_123/ads");
      expect(url.searchParams.get("limit")).toBe("25");
      expect(url.searchParams.has("filtering")).toBe(false);
      return Response.json(body);
    }));
    const {payload} = await invoke({adAccountId: "123", limit: 25});
    expect(payload.data).toEqual(body.data);
    expect(payload.paging).toEqual(body.paging);
  });
});
