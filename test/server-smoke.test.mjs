import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(repoRoot, "..", "..");
const binName = process.platform === "win32" ? "tsx.cmd" : "tsx";
const localTsxBin = path.join(repoRoot, "node_modules", ".bin", binName);
const workspaceTsxBin = path.join(workspaceRoot, "node_modules", ".bin", binName);
const tsxBin = fs.existsSync(localTsxBin) ? localTsxBin : workspaceTsxBin;

function cleanEnv(extra) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
    ...extra,
  };
}

test("Meta Ads MCP exposes core tools and resources over stdio", async () => {
  const client = new Client({ name: "meta-ads-mcp-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: tsxBin,
    args: ["src/cli.ts"],
    cwd: repoRoot,
    env: cleanEnv({
      META_ACCESS_TOKEN: "test-meta-access-token",
      META_API_VERSION: "v26.0",
      LOG_LEVEL: "error",
    }),
    stderr: "pipe",
  });

  try {
    await client.connect(transport, { timeout: 15000 });
    const tools = await client.listTools(undefined, { timeout: 15000 });
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.equal(toolNames.length, 39);

    for (const name of [
      "meta_health_check",
      "meta_get_insights",
      "meta_validate_query",
      "meta_get_creative_assets",
      "meta_get_node_fields",
      "meta_list_edge_raw",
      "meta_get_insights_raw",
      "meta_search_targeting_options",
      "meta_get_ad_preview",
    ]) {
      assert.ok(toolNames.includes(name), `missing tool ${name}`);
    }

    const resources = await client.listResources(undefined, { timeout: 15000 });
    const resourceUris = resources.resources.map((resource) => resource.uri);

    for (const uri of [
      "meta://manifest",
      "meta://metrics",
      "meta://compatibility",
    ]) {
      assert.ok(resourceUris.includes(uri), `missing resource ${uri}`);
    }

    const manifest = await client.readResource({ uri: "meta://manifest" }, { timeout: 15000 });
    const manifestPayload = JSON.parse(manifest.contents[0].text);
    assert.equal(manifestPayload.tools.length, 39);
    assert.ok(manifestPayload.tools.includes("meta_get_insights_raw"));
  } finally {
    await transport.close().catch(() => undefined);
  }
});
