import { PARAMETER_DESCRIPTIONS } from "./parameter-descriptions.js";
/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
/** A stable structured envelope for the heterogeneous provider responses.
 * The original MCP content and MCP Apps payload remain unchanged. Provider
 * fields deliberately remain open: native query tools accept selected fields.
 */
export const RESULT_SCHEMA = {
  type: "object" as const,
  properties: {
    result: {
      description: "Original tool result: parsed JSON when the text is JSON, otherwise the text or multiple MCP content blocks. Provider fields depend on the selected query. Existing MCP Apps fields are returned alongside result.",
      type: ["object", "array", "string", "number", "boolean", "null"],
    },
  },
  required: ["result"],
  additionalProperties: true,
};

export type ToolAnnotations = {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export function toolAnnotations(write: boolean): ToolAnnotations {
  // Conservative for writes: an update can replace existing data, and a
  // creation or upload must never be blindly retried after an uncertain reply.
  return { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write, openWorldHint: true };
}

export function structuredResult<T extends { content: unknown[]; isError?: boolean; structuredContent?: Record<string, unknown> }>(value: T): T {
  if (value.isError) return value;
  let result: unknown = value.content;
  const first = value.content[0] as { type?: string; text?: string } | undefined;
  if (value.content.length === 1 && first?.type === "text" && typeof first.text === "string") {
    result = first.text;
    try { result = JSON.parse(first.text); } catch { /* Plain text is valid. */ }
  }
  return { ...value, structuredContent: { ...value.structuredContent, result } };
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export type ToolShape = Record<string, z.ZodTypeAny>;
const resultShape = { result: z.union([z.object({}).passthrough(), z.array(z.unknown()), z.string(), z.number(), z.boolean(), z.null()]).describe(RESULT_SCHEMA.properties.result.description) };

/** Adapt legacy tool registrations through the public SDK API. No credentials
 * or tool execution are required to construct the metadata catalogue. */
export function installToolQuality(server: McpServer): void {
  server.tool = ((name: string, description: string, inputSchema: ToolShape, handler: (...args: any[]) => any) => {
    const write = Object.hasOwn(inputSchema, "confirm");
    inputSchema = Object.fromEntries(Object.entries(inputSchema).map(([key, schema]) => [key, schema.description || PARAMETER_DESCRIPTIONS[key] ? schema.describe(schema.description || PARAMETER_DESCRIPTIONS[key]) : schema]));
    return server.registerTool(name, {
      title: name.replace(/_/g, " "), description, inputSchema,
      outputSchema: resultShape, annotations: toolAnnotations(write),
    }, async (...args: any[]) => structuredResult(await handler(...args)));
  }) as typeof server.tool;
}
