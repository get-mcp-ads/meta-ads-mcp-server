import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMetaGraphReadUrl, encodeExtraGraphParams, META_BROAD_READ_EDGES } from "../src/platforms/meta/broad-read.ts";
import { assertSafeMetaGraphUrl, MetaClient } from "../src/platforms/meta/client.ts";

test("Meta broad read URL builder safely encodes native fields and filters", () => {
  const url = new URL(buildMetaGraphReadUrl("v26.0", "act_123/insights", {
    fields: "impressions,spend,new_native_metric",
    filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: ["42"] }]),
    limit: 100,
  }));

  assert.equal(url.origin, "https://graph.facebook.com");
  assert.equal(url.pathname, "/v26.0/act_123/insights");
  assert.equal(url.searchParams.get("fields"), "impressions,spend,new_native_metric");
  assert.equal(url.searchParams.get("limit"), "100");
});

test("Meta token-bearing URL guard rejects other hosts and versions", () => {
  assert.equal(
    assertSafeMetaGraphUrl("https://graph.facebook.com/v26.0/act_123/ads", "v26.0").hostname,
    "graph.facebook.com",
  );
  assert.throws(
    () => assertSafeMetaGraphUrl("https://example.com/v26.0/act_123/ads", "v26.0"),
    /restricted/,
  );
  assert.throws(
    () => assertSafeMetaGraphUrl("https://graph.facebook.com/v23.0/act_123/ads", "v26.0"),
    /configured API version/,
  );
  assert.throws(
    () => assertSafeMetaGraphUrl("https://graph.facebook.com:444/v26.0/act_123/ads", "v26.0"),
    /restricted/,
  );
  assert.throws(
    () => assertSafeMetaGraphUrl("https://user:pass@graph.facebook.com/v26.0/act_123/ads", "v26.0"),
    /restricted/,
  );
});

test("Meta broad edge allowlist excludes lead-record PII", () => {
  assert.equal(META_BROAD_READ_EDGES.includes("leadgen_forms"), true);
  assert.equal(META_BROAD_READ_EDGES.includes("leads"), false);
});

test("Meta broad read path rejects traversal and query injection", () => {
  assert.throws(() => buildMetaGraphReadUrl("v26.0", "../me", {}), /Invalid/);
  assert.throws(() => buildMetaGraphReadUrl("v26.0", "act_1/ads?access_token=x", {}), /Invalid/);
});

test("Meta extra edge parameters allow planning inputs but block Graph method overrides", () => {
  assert.deepEqual(encodeExtraGraphParams({
    optimization_goal: "LINK_CLICKS",
    targeting_spec: { geo_locations: { countries: ["FR"] } },
  }), {
    optimization_goal: "LINK_CLICKS",
    targeting_spec: '{"geo_locations":{"countries":["FR"]}}',
  });
  assert.throws(() => encodeExtraGraphParams({ method: "delete" }), /blocked for safety/);
  assert.throws(() => encodeExtraGraphParams({ access_token: "secret" }), /blocked for safety/);
});

test("Meta client refuses HTTP redirects after attaching an access token", async () => {
  const originalFetch = globalThis.fetch;
  let seenInit;
  globalThis.fetch = async (_input, init) => {
    seenInit = init;
    return new Response(JSON.stringify({ id: "act_123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new MetaClient("secret-token", "v26.0");
    await client.fetchUrl("https://graph.facebook.com/v26.0/act_123?fields=id");
    assert.equal(seenInit.redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
