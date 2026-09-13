/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { MetaClient, MetaApiException } from "./client.js";

type Row = Record<string, any>;
export type BusinessAssetArgs = {
  businessId?: string;
  adAccountId?: string;
  limit?: number;
  cursor?: string;
  cursors?: Record<string, string>;
  maxPages?: number;
};
const record = (x: unknown): x is Row =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** Each cursor belongs to one edge. Failed reads never imply an empty inventory. */
export async function getBusinessAssets(
  client: MetaClient,
  args: BusinessAssetArgs,
) {
  const limit = args.limit ?? 100,
    maxPages = args.maxPages ?? 3;
  if (args.cursor && (args.businessId || args.adAccountId))
    throw Error(
      "Use per-edge cursors for scoped Business discovery; cursor is only for /me/businesses.",
    );
  const warnings: Row[] = [],
    coverage: Record<string, Row> = {},
    paging: Record<string, Row> = {};
  const stores = {
    businesses: new Map<string, Row>(),
    pages: new Map<string, Row>(),
    instagram_accounts: new Map<string, Row>(),
    pixels: new Map<string, Row>(),
    datasets: new Map<string, Row>(),
  };
  let requests = 0;
  let account: Row | null = null;
  const url = (path: string, params: Row) => {
    const u = new URL(
      `https://graph.facebook.com/${client.apiVersion}/${path}`,
    );
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  };
  const errorInfo = (e: unknown) => ({
    message: e instanceof Error ? e.message : String(e),
    ...(e instanceof MetaApiException
      ? { code: e.code, subcode: e.subcode }
      : {}),
  });
  const get = async (path: string, params: Row) => {
    requests++;
    const r = await client.fetchUrl(url(path, params));
    if (record(r.error)) throw new MetaApiException(r.error as any);
    return r;
  };
  const add = (
    kind: keyof typeof stores,
    items: Row[],
    source: string,
    context: Row = {},
  ) => {
    for (const item of items) {
      if (!item.id) continue;
      const id = String(item.id),
        old = stores[kind].get(id);
      stores[kind].set(id, {
        ...old,
        ...item,
        ...context,
        source,
        relationships: [
          ...new Map(
            [...(old?.relationships ?? []), { source, ...context }].map((r) => [
              JSON.stringify(r),
              r,
            ]),
          ).values(),
        ],
        sources: [...new Set([...(old?.sources ?? []), source])],
      });
    }
  };
  const node = async (path: string, fields: string) => {
    try {
      const r = await get(path, { fields });
      coverage[path] = { status: "complete", returnedCount: 1 };
      return r;
    } catch (e) {
      const error = errorInfo(e);
      coverage[path] = { status: "unavailable", returnedCount: null, error };
      warnings.push({
        area: path,
        ...error,
        suggestion:
          "Verify access to this exact asset; an unavailable read is not an empty result.",
      });
      return null;
    }
  };
  const edge = async (
    path: string,
    fields: string,
    fallbackFields?: string,
  ) => {
    const rows: Row[] = [];
    let after =
      args.cursors?.[path] ??
      (path === "me/businesses" ? args.cursor : undefined);
    let pages = 0;
    try {
      for (; pages < maxPages;) {
        let r: Row;
        try {
          r = await get(path, { fields, limit, after });
        } catch (e) {
          if (
            !fallbackFields ||
            pages !== 0 ||
            !(e instanceof MetaApiException) ||
            ![10, 100, 200].includes(e.code)
          )
            throw e;
          const area = `${path}:instagram_links`;
          const error = errorInfo(e);
          coverage[area] = {
            status: "unavailable",
            returnedCount: null,
            error,
          };
          warnings.push({
            area,
            ...error,
            suggestion:
              "Page identity is retried without Instagram expansions. Missing Instagram links are unavailable, not proof that no account is linked.",
          });
          fields = fallbackFields;
          fallbackFields = undefined;
          r = await get(path, { fields, limit, after });
        }
        if (!Array.isArray(r.data))
          throw Error("Meta did not return a list for this edge.");
        rows.push(...r.data.filter(record));
        pages++;
        const pg = record(r.paging) ? r.paging : {};
        const hasMore = typeof pg.next === "string" && pg.next.length > 0;
        after =
          record(pg.cursors) && typeof pg.cursors.after === "string"
            ? pg.cursors.after
            : undefined;
        if (hasMore && !after) {
          const next = new URL(String(pg.next));
          if (
            next.origin !==
              new URL(`https://graph.facebook.com/${client.apiVersion}`)
                .origin ||
            next.pathname !== new URL(url(path, {})).pathname
          )
            throw Error("Untrusted pagination route.");
          after = next.searchParams.get("after") ?? undefined;
        }
        if (!hasMore) {
          coverage[path] = {
            status: rows.length ? "complete" : "empty",
            returnedCount: rows.length,
            pagesFetched: pages,
            hasMore: false,
          };
          return rows;
        }
        if (!after)
          throw Error(
            "Meta indicated more results without a usable edge cursor.",
          );
      }
      coverage[path] = {
        status: "partial",
        returnedCount: rows.length,
        pagesFetched: pages,
        hasMore: true,
      };
      paging[path] = {
        after,
        resume: {
          ...args,
          cursor: undefined,
          cursors: { ...args.cursors, [path]: after },
        },
      };
    } catch (e) {
      const error = errorInfo(e);
      coverage[path] = {
        status: rows.length ? "partial" : "unavailable",
        returnedCount: rows.length || null,
        pagesFetched: pages,
        hasMore: null,
        error,
      };
      warnings.push({
        area: path,
        ...error,
        suggestion:
          "Check this edge and its asset permissions. Missing data is not zero; inspect status and returnedCount for this edge.",
      });
    }
    return rows;
  };
  if (args.adAccountId) {
    const act = args.adAccountId.replace(/^act_/, "");
    if (!/^\d+$/.test(act)) throw Error("Invalid ad account ID");
    account = await node(
      `act_${act}`,
      "id,name,business{id,name,verification_status}",
    );
  }
  const owner = record(account?.business) ? account.business : null;
  if (args.businessId && owner && String(owner.id) !== args.businessId)
    throw Error(
      "Provided Business does not own the selected ad account. No unrelated Business was queried.",
    );
  const businessId =
    args.businessId ?? (owner?.id ? String(owner.id) : undefined);
  if (businessId) {
    if (!/^\d+$/.test(businessId)) throw Error("Invalid Business ID");
    const b = await node(businessId, "id,name,verification_status");
    if (b) add("businesses", [b], businessId);
    else if (owner) add("businesses", [owner], "ad_account.business");
  } else if (!args.adAccountId)
    add(
      "businesses",
      await edge("me/businesses", "id,name,verification_status"),
      "me/businesses",
    );
  else
    warnings.push({
      area: "ad_account.business",
      message:
        "The selected account did not return its owning Business. Discovery was not broadened to unrelated Businesses.",
      suggestion: "Verify access or supply the intended businessId explicitly.",
    });
  if (args.adAccountId && account)
    add(
      "pixels",
      await edge(`${account.id}/adspixels`, "id,name,last_fired_time"),
      `${account.id}/adspixels`,
      { ad_account_id: account.id },
    );
  // Bound expansion of a broad /me/businesses discovery. Return explicit continuation scope.
  const bs = [...stores.businesses.values()];
  if (bs.length > 5)
    warnings.push({
      area: "business_expansion",
      message: "Assets are expanded for the first five Businesses only.",
      suggestion: "Repeat with businessId for any other listed Business.",
    });
  for (const b of bs.slice(0, 5)) {
    const id = String(b.id);
    for (const relation of ["owned_pages", "client_pages"]) {
      const path = `${id}/${relation}`;
      const pages = await edge(
        path,
        "id,name,category,tasks,instagram_business_account{id,username,name},connected_instagram_account{id,username,name}",
        "id,name,category,tasks",
      );
      add("pages", pages, path, { business_id: id });
      for (const page of pages)
        for (const field of [
          "instagram_business_account",
          "connected_instagram_account",
        ])
          if (record(page[field]))
            add("instagram_accounts", [page[field]], `${path}:${field}`, {
              business_id: id,
              page_id: page.id,
            });
    }
    add(
      "instagram_accounts",
      await edge(`${id}/owned_instagram_accounts`, "id,username,name"),
      `${id}/owned_instagram_accounts`,
      { business_id: id },
    );
    // Business assets have a different ID space from IG professional account nodes.
    const igAssets = await edge(
      `${id}/client_instagram_assets`,
      "id,ig_user_id,ig_username",
    );
    for (const a of igAssets)
      if (a.ig_user_id)
        add(
          "instagram_accounts",
          [
            {
              id: String(a.ig_user_id),
              username: a.ig_username,
              business_asset_id: a.id,
            },
          ],
          `${id}/client_instagram_assets`,
          { business_id: id },
        );
    for (const relation of ["owned_pixels", "client_pixels"])
      add(
        "pixels",
        await edge(`${id}/${relation}`, "id,name,last_fired_time"),
        `${id}/${relation}`,
        { business_id: id },
      );
    add(
      "datasets",
      await edge(`${id}/ads_dataset`, "id,name"),
      `${id}/ads_dataset`,
      { business_id: id },
    );
  }
  const unavailable = Object.entries(coverage)
    .filter(([, c]) => c.status === "unavailable" || c.status === "partial")
    .map(([edge]) => edge);
  const datasetsQueried = Object.entries(coverage).filter(([p]) =>
    p.endsWith("/ads_dataset"),
  );
  return {
    scope: {
      mode: args.adAccountId
        ? "ad_account"
        : args.businessId
          ? "business"
          : "accessible_businesses",
      requested_ad_account_id: args.adAccountId ?? null,
      requested_business_id: args.businessId ?? null,
    },
    ad_account: account,
    account_business: owner,
    ...Object.fromEntries(
      Object.entries(stores).map(([k, v]) => [k, [...v.values()]]),
    ),
    counts: {
      ...Object.fromEntries(
        Object.entries(stores).map(([k, v]) => [k, v.size]),
      ),
      datasets:
        !datasetsQueried.length ||
        datasetsQueried.every(([, c]) => c.status === "unavailable")
          ? null
          : stores.datasets.size,
    },
    coverage,
    paging,
    warnings,
    limitations: [
      ...unavailable.map((edge) => ({ edge, status: coverage[edge].status })),
      ...(bs.length > 5
        ? [{ area: "business_expansion", status: "partial" }]
        : []),
    ],
    notes: [
      "Counts describe returned records, not the size of inaccessible inventories. Inspect per-edge coverage.",
      "Source edges show owned/client/linked relationships; presence in a Business inventory does not prove assignment to the selected ad account.",
      "Page tasks and linked Instagram references do not prove that every API operation is authorized. Use relationships to retain all observed Business/Page associations for deduplicated assets.",
      "Dataset discovery uses Business ads_dataset; it is not the removed offline_conversion_data_sets edge.",
    ],
    nextActions: Object.entries(paging).map(([edge, p]) => ({
      edge,
      tool: "meta_get_business_assets",
      arguments: p.resume,
    })),
    debug: { requestCount: requests },
  };
}
