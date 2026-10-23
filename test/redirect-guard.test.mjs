/**
 * Every outbound call carries the Meta access token. Following a redirect
 * would forward that credential to whatever host the redirect names, so no
 * fetch in this codebase may omit redirect handling, and no host other than
 * the Graph API may appear as a call target.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function sourceFiles(dir = "src", acc = []) {
  for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(`${dir}/${entry.name}`, acc);
    else if (entry.name.endsWith(".ts")) acc.push(`${dir}/${entry.name}`);
  }
  return acc;
}

/** The argument list of the call that opens at `open`, by bracket matching. */
function callArguments(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

test("every fetch refuses to follow redirects", () => {
  const offenders = [];
  let calls = 0;
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/(?<![\w.])fetch\(/g)) {
      calls++;
      const args = callArguments(text, match.index + "fetch".length);
      if (!/redirect\s*:\s*["'](error|manual)["']/.test(args)) {
        offenders.push(`${file}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
  }
  assert.ok(calls >= 5, `expected the Graph fetch calls to be found, saw ${calls}`);
  assert.deepEqual(
    offenders,
    [],
    `These fetch calls may follow a redirect and leak the token: ${offenders.join(", ")}`,
  );
});

test("the only host this server can reach is the Graph API", () => {
  const hosts = new Set();
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].replace(/\.$/, "").toLowerCase();
      // Product links, the server icon and documentation references are not call targets.
      if (["www.getmcpads.com", "mcp.getmcpads.com", "www.postman.com"].includes(host)) continue;
      hosts.add(host);
    }
  }
  assert.deepEqual(
    [...hosts].sort(),
    ["graph.facebook.com"],
    "A new outbound host appeared. That is a deliberate decision, not an accident.",
  );
});
