#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MCP = {
  displayName: "Meta Ads MCP",
  packageName: "@getmcpads/meta-ads-mcp-server",
  binName: "meta-ads-mcp",
  repoName: "meta-ads-mcp",
  claudeKeys: ["meta-ads-mcp", "facebook-mcp", "meta-ads-mcp"],
  requiredEnv: ["META_ACCESS_TOKEN"],
  requiredEnvAlternatives: [],
  optionalEnv: ["META_ENABLE_WRITES", "META_API_VERSION", "LOG_LEVEL"],
};

const CLAUDE_CONFIG_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "claude_desktop_config.json",
);
const READ_ONLY_TERMS = ["write", "mutate", "create", "update", "delete"];
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(targetPath) {
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw);
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string").join(" ").toLowerCase();
  }
  return "";
}

function getClaudeServers(config) {
  if (!config || typeof config !== "object" || !config.mcpServers || typeof config.mcpServers !== "object") {
    return [];
  }

  return Object.entries(config.mcpServers).map(([name, server]) => {
    const env = server?.env && typeof server.env === "object" ? server.env : {};
    const envKeys = Object.keys(env).sort().map((envName) => ({
      name: envName,
      present: typeof env[envName] === "string" ? env[envName].length > 0 : Boolean(env[envName]),
    }));

    return {
      name,
      commandText: normalizeText(server?.command),
      argsText: normalizeText(server?.args),
      envKeys,
      hasCommand: Boolean(server?.command),
      hasArgs: Array.isArray(server?.args) && server.args.length > 0,
    };
  });
}

function serverLooksRelated(server) {
  const haystack = `${server.name} ${server.commandText} ${server.argsText}`.toLowerCase();
  const needles = [
    MCP.packageName,
    MCP.binName,
    MCP.repoName,
    ...MCP.claudeKeys,
    MCP.displayName,
  ].map((value) => value.toLowerCase());

  return needles.some((needle) => haystack.includes(needle));
}

async function checkClaudeDesktopConfig() {
  const configExists = await pathExists(CLAUDE_CONFIG_PATH);
  if (!configExists) {
    return {
      name: "claudeDesktopConfig",
      ok: false,
      configExists,
      referenced: false,
      matches: [],
      envKeys: [],
      envNames: [],
    };
  }

  try {
    const config = await readJson(CLAUDE_CONFIG_PATH);
    const matches = getClaudeServers(config).filter(serverLooksRelated);
    const envPresence = new Map();
    for (const match of matches) {
      for (const envKey of match.envKeys) {
        envPresence.set(envKey.name, Boolean(envPresence.get(envKey.name)) || envKey.present);
      }
    }
    const envKeys = [...envPresence.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, present]) => ({ name, present }));

    return {
      name: "claudeDesktopConfig",
      ok: matches.length > 0,
      configExists,
      referenced: matches.length > 0,
      matches: matches.map((match) => ({
        name: match.name,
        hasCommand: match.hasCommand,
        hasArgs: match.hasArgs,
        envKeys: match.envKeys,
      })),
      envKeys,
      envNames: envKeys.map((envKey) => envKey.name),
    };
  } catch (error) {
    return {
      name: "claudeDesktopConfig",
      ok: false,
      configExists,
      referenced: false,
      parseError: error instanceof Error ? error.message : String(error),
      matches: [],
      envKeys: [],
      envNames: [],
    };
  }
}

function envPresence(name, claudeEnvPresence) {
  const currentProcess = typeof process.env[name] === "string" && process.env[name].length > 0;
  const claudeDesktop = claudeEnvPresence.get(name) === true;
  return {
    name,
    currentProcess,
    claudeDesktop,
    present: currentProcess || claudeDesktop,
  };
}

function checkEnvironment(claudeEnvPresence) {
  const required = MCP.requiredEnv.map((name) => envPresence(name, claudeEnvPresence));
  const requiredAlternativeGroups = MCP.requiredEnvAlternatives.map((group) =>
    group.map((name) => envPresence(name, claudeEnvPresence)),
  );
  const optional = MCP.optionalEnv.map((name) => envPresence(name, claudeEnvPresence));
  const requiredOk = required.every((item) => item.present);
  const alternativesOk =
    requiredAlternativeGroups.length === 0 ||
    requiredAlternativeGroups.some((group) => group.every((item) => item.present));

  return {
    name: "environment",
    ok: requiredOk && alternativesOk,
    required,
    requiredAlternativeGroups,
    optional,
  };
}

// The same check the server runs at startup. The built module is preferred;
// the TypeScript source works on Node releases that strip types by default.
async function checkNodeRuntime() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const candidate of ["dist/runtime-check.js", "src/runtime-check.ts"]) {
    try {
      const { nodeRuntimeWarning } = await import(pathToFileURL(path.join(root, candidate)).href);
      const warning = nodeRuntimeWarning();
      return { name: "nodeRuntime", ok: !warning, version: process.versions.node, ...(warning ? { warning } : {}) };
    } catch {
      // Try the next candidate.
    }
  }
  return {
    name: "nodeRuntime",
    ok: false,
    version: process.versions.node,
    warning: "The runtime check could not be loaded. Run npm run build, then rerun npm run doctor.",
  };
}

async function checkPackageAndBuild() {
  const packageExists = await pathExists("package.json");
  const srcExists = await pathExists("src");
  let packageJson = {};
  let packageJsonValid = false;

  if (packageExists) {
    try {
      packageJson = await readJson("package.json");
      packageJsonValid = true;
    } catch {
      packageJsonValid = false;
    }
  }

  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const hasBuildScript = Boolean(scripts.build);
  const distExists = await pathExists("dist");

  return {
    name: "packageAndBuild",
    ok: packageExists && packageJsonValid && srcExists,
    packageJson: packageExists,
    packageJsonValid,
    src: srcExists,
    buildScript: hasBuildScript,
    dist: distExists,
  };
}

async function collectSourceFiles(root) {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        return [entryPath];
      }
      return [];
    }),
  );

  return files.flat();
}

async function checkReadOnlyPosture() {
  const files = await collectSourceFiles("src");
  const byTerm = new Map(READ_ONLY_TERMS.map((term) => [term, new Map()]));

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    for (const term of READ_ONLY_TERMS) {
      const pattern = new RegExp(`\\b${term}\\b`, "gi");
      const count = content.match(pattern)?.length ?? 0;
      if (count > 0) {
        byTerm.get(term).set(file, count);
      }
    }
  }

  const findings = [...byTerm.entries()]
    .map(([term, fileCounts]) => ({
      term,
      count: [...fileCounts.values()].reduce((sum, count) => sum + count, 0),
      files: [...fileCounts.entries()].map(([file, count]) => ({ file, count })),
    }))
    .filter((finding) => finding.count > 0);

  return {
    name: "readOnlyPosture",
    ok: true,
    scannedFiles: files.length,
    findings,
  };
}

function buildWarningsAndActions({ envCheck, packageCheck, claudeCheck, readOnlyCheck, runtimeCheck }) {
  const warnings = [];
  const nextActions = [];

  if (!runtimeCheck.ok) {
    warnings.push(runtimeCheck.warning);
    nextActions.push("Install a Node.js release listed in package.json engines before running the server.");
  }

  if (!envCheck.ok) {
    warnings.push("Missing required environment variables in both current process and matching Claude Desktop config.");
    nextActions.push("Add the missing required env vars to the shell or to the MCP entry in Claude Desktop config.");
  }

  if (packageCheck.buildScript && !packageCheck.dist) {
    warnings.push("Build script exists but dist/ is not present.");
    nextActions.push("Run npm run build before starting from dist or publishing.");
  }

  if (!claudeCheck.configExists) {
    warnings.push("Claude Desktop config file was not found.");
    nextActions.push("Create or update Claude Desktop config with this MCP server entry.");
  } else if (!claudeCheck.referenced) {
    warnings.push("No matching Claude Desktop MCP server entry was detected.");
    nextActions.push("Add this MCP server to Claude Desktop config.");
  }

  if (readOnlyCheck.findings.length > 0) {
    warnings.push("Read-only keyword scan found source terms to review.");
    nextActions.push("Review read-only posture findings; tool descriptions and compatibility text can be false positives.");
  }

  return { warnings, nextActions };
}

async function main() {
  const claudeCheck = await checkClaudeDesktopConfig();
  const claudeEnvPresence = new Map((claudeCheck.envKeys ?? []).map((envKey) => [envKey.name, envKey.present]));
  const envCheck = checkEnvironment(claudeEnvPresence);
  const packageCheck = await checkPackageAndBuild();
  const readOnlyCheck = await checkReadOnlyPosture();
  const runtimeCheck = await checkNodeRuntime();
  const { warnings, nextActions } = buildWarningsAndActions({
    envCheck,
    packageCheck,
    claudeCheck,
    readOnlyCheck,
    runtimeCheck,
  });
  const hardChecksOk = runtimeCheck.ok && envCheck.ok && packageCheck.ok && claudeCheck.ok;
  const result = {
    ok: hardChecksOk,
    checks: [runtimeCheck, envCheck, packageCheck, claudeCheck, readOnlyCheck],
    warnings,
    nextActions,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  const result = {
    ok: false,
    checks: [],
    warnings: ["Doctor failed before completing checks."],
    nextActions: ["Inspect the doctor script error and rerun npm run doctor."],
    error: error instanceof Error ? error.message : String(error),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
});
