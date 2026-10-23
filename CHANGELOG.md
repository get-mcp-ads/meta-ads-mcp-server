# Changelog

## 2.1.0 - 2026-10-23 - Gateway sync and runtime security update
- Add `meta_rename_ad_account` (write) and `meta_get_promotable_apps` (read), synchronized from getmcpads revision 3e1c2c8. The server exposes 42 read tools and 24 write tools.
- Accept `applink_treatment` and `omnichannel_link_spec` on new creatives, validate website and app promoted objects, and return the creative requirements of a website and app ad set from `meta_get_adset_configuration`.
- Add `campaignIds`, `adsetIds`, `effectiveStatus`, `dimensions` and `actionBreakdowns` to `meta_get_insights`. A request for `conversions` or `conversion_values` also reads the action arrays that carry purchases, leads and revenue, and the response lists the metrics it added.
- Return quality rankings as text at ad level, keep missing revenue distinct from zero revenue, and compute website and app order values from their own purchase events.
- Report a security checkpoint or a missing creative destination on a confirmed ad creation as a conclusive refusal. A server error, an ambiguous receipt or an unclear validation result is reported as an unknown outcome. No write is retried.
- Fall back to `/me` and `/me/permissions` in `meta_health_check` and `meta_debug_token` when Meta refuses token inspection. A check that could not run is reported as unknown, not as a missing permission.
- Send the access token in the Authorization header on every request, redact it from provider errors and logs, and stop reading a response after 25 MB.
- Require Node.js 22.23.4 or newer on the 22 line, 24.22.1 or newer on the 24 line, or 26.12.1 or newer. An older runtime starts with a warning on stderr, and `npm run doctor` reports the same check.
- Update `@modelcontextprotocol/sdk` to 1.32.1 and regenerate the lockfile. `npm audit --omit=dev` reports no vulnerabilities.
- Run CI on Node 22, 24 and 26 every week and on every change, with a runtime dependency audit. Publish from version tags with `release.yml`, which replaces `publish-mcp.yml`.

## 2.0.1 - 2026-09-23 - Public repository restored

- Restore public source hosting under the get-mcp-ads GitHub organization.
- Update repository and support links while preserving npm package and MCP registry names.
- No changes to platform tools or credential requirements.

## 2.0.0 - 2026-09-20 - Gateway sync and security fixes
- Use account-scoped creative reads compatible with Graph v26, including bounded historical fallback and ownership verification.
- Add exact entity configuration and uploaded-video readiness reads.
- Update campaign creation, budget ownership, schedule validation and post-write verification.
- Require Node.js 22.12 or newer and check Node 22/24 in CI.
- Update vulnerable dependencies and regenerate the MCP catalog.
- No hosted creative UI or MCP Apps integrations.


## 1.1.0 - 2026-09-13 - Platform capability sync and quality contracts
- Synchronize applicable platform features with GetMCPAds commit b1471be while retaining local read-only exploration tools and credential configuration.
- Expose 39 read tools and 23 explicitly enabled write tools.
- Add MCP annotations, parameter descriptions, structured results, server identity and an offline-generated discovery card.
- Preserve preview/confirmation boundaries; test provider request construction and errors with mocked APIs.
- Refuse credential-bearing redirects and document provider-specific limitations.

No live advertiser mutation is performed by the release tests.

## 1.0.2 - 2026-08-30

- Announce the package version over MCP. Version 1.0.1 still reported 1.0.0 in the handshake.

## 1.0.1 - 2026-08-30

- Add `server.json` and `mcpName` for the official MCP Registry, under `com.getmcpads/meta-ads`.
- Skip registry publication when a version is already listed.

## 1.0.0 - 2026-08-29 - First open-source release

- Publish the server as open source under the Apache-2.0 license.
