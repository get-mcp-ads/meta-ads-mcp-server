/**
 * meta-ads-mcp-server: an open-source MCP server for the Facebook (Meta) Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MCP cursor-based pagination helpers.
 *
 * Cursors are opaque base64-encoded JSON objects containing the offset.
 */

interface CursorData {
  offset: number;
}

const DEFAULT_PAGE_SIZE = 100;

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset } satisfies CursorData)).toString("base64url");
}

export function decodeCursor(cursor: string): number {
  try {
    const data = JSON.parse(Buffer.from(cursor, "base64url").toString()) as CursorData;
    return data.offset;
  } catch {
    return 0;
  }
}

/**
 * Paginate an array of items using MCP cursor conventions.
 */
export function paginate<T>(
  items: T[],
  cursor?: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { data: T[]; nextCursor?: string } {
  const offset = cursor ? decodeCursor(cursor) : 0;
  const page = items.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < items.length;

  return {
    data: page,
    ...(hasMore && { nextCursor: encodeCursor(offset + pageSize) }),
  };
}
