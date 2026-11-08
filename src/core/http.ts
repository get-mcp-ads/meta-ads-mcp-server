/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */

/** Largest Graph API response body this server reads, in bytes. */
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`Meta returned more than ${Math.round(limit / 1024 / 1024)} MB in one response. Narrow the request (fewer fields, a shorter date range or a lower limit) and try again.`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Read a response body as text without holding more than `limit` bytes.
 * A declared Content-Length above the limit is refused before reading.
 */
export async function readBoundedText(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(limit);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(limit);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/** Parse a bounded response body as JSON. Throws on an oversized or non-JSON body. */
export async function readBoundedJson<T = unknown>(response: Response, limit = MAX_RESPONSE_BYTES): Promise<T> {
  return JSON.parse(await readBoundedText(response, limit)) as T;
}
