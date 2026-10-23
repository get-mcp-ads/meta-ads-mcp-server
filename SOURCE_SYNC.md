# Source synchronization

Reviewed on 2026-10-23 against getmcpads source revision `3e1c2c8`. The previous review used revision `41cc1ca`.

## Synchronized in 2.1.0

- `meta_rename_ad_account` renames an ad account after reading it, and previews unless `confirm` is true.
- `meta_get_promotable_apps` lists the apps an ad account can advertise, with their store URLs.
- New creatives accept `applink_treatment` and `omnichannel_link_spec`. Website and app promoted objects are validated before any request, and `meta_get_adset_configuration` returns the creative requirements of a website and app ad set from its own ads. `meta_get_entity_configuration` can read both fields back.
- A security checkpoint or a missing creative destination on a confirmed ad creation is reported as a conclusive refusal with its trace ID. A server error, an ambiguous receipt or an unclear validation result stays an unknown outcome.
- `meta_get_insights` accepts campaign, ad set, effective status, dimension and action breakdown filters, adds the action arrays that `conversions` and `conversion_values` need, and computes spend and revenue shares on unsegmented reports.
- Quality rankings are text fields at ad level. Website purchase ratios and order values no longer fall back to purchases from other channels, an app order value is added, and ROAS variants stay missing when revenue is missing.
- `meta_health_check` and `meta_debug_token` read `/me` and `/me/permissions` when token inspection is refused, and report unavailable checks as unknown. Graph reads send the token in the Authorization header, redact it from provider errors, and report transport and parsing failures without echoing request values.

## Kept standalone

- The gateway inspects tokens with its own app credentials. This server has none, so it asks Meta to inspect the token with itself first, which works for System User tokens and for users who develop the app, and falls back to the unprivileged checks above.
- `meta_get_entity_configuration` is the standalone name of the gateway's `meta_inspect_launcher_entity`, which serves the hosted Launcher and is not exposed here.
- Six tools have no gateway counterpart and remain: `meta_get_node_fields`, `meta_list_edge_raw`, `meta_get_insights_raw`, `meta_search_targeting_options`, `meta_get_ad_preview` and `meta_get_entity_configuration`.
- Existing standalone protections are retained: preview before every write, ownership checks before mutations, the Graph host and version guard, refused redirects, and the 25 MB response bound added in this release.

## Hosted only

Alerts and their hourly checks, Google Sheets exports, the Launcher (proposals, media import, recovery receipts and revisions), billing, workspaces, stored account selection, client memory, creative galleries and MCP Apps UI are outside this synchronization.

Validation uses synthetic data. No live advertising write is required by the test suite. The generated server-card.json is the source of truth for this revision's tool schemas.

Maintainer: Emmanuel, getmcpads. Contact: hello@getmcpads.com.
