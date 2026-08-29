# meta-ads-mcp-server

[![CI](https://github.com/getmcpads-com/meta-ads-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/getmcpads-com/meta-ads-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server for the
**Facebook (Meta) Ads Marketing API**. It lets Claude, ChatGPT, Cursor or any MCP client
read and analyse your advertising data, and change it if you choose to.

You run it. Your token stays on your machine. Nothing is proxied through a third party.

```bash
npx -y @getmcpads/meta-ads-mcp-server
```

> **Prefer not to run it yourself?** [getmcpads.com](https://www.getmcpads.com) is the hosted
> version of this server, with Meta Ads alongside Google Ads, TikTok Ads, Pinterest Ads, GA4 and
> Search Console behind a single endpoint, hosted OAuth, and cross-platform reporting.
> Same tools, same safety model, no setup.

---

## What you get

| | |
|---|---|
| **34 read tools** | Campaigns, ad sets, ads, creatives, audiences, pixels, catalogs, Pages, Instagram, activity logs, A/B tests and lift studies |
| **10 write tools** | Off by default. Status, budgets, schedules, renames, campaign creation. Each one **previews before it applies** |
| **190 metrics** | Including derived ones computed client-side (ROAS, CPA, frequency, hook rate, attribution-window views) |
| **56 breakdowns · 90 dimensions** | With a compatibility matrix that catches invalid combinations *before* they hit the API |
| **7 resources** | Live catalogues the model can read: metrics, breakdowns, compatibility rules, 11 workflow recipes |
| **Forward-compatible reads** | `meta_get_node_fields`, `meta_list_edge_raw`, `meta_get_insights_raw` reach Graph fields this server doesn't model yet |

### The query planner

Meta rejects many metric/breakdown combinations, and the error messages rarely say why.
This server encodes the compatibility matrix, so it **splits an impossible request into
several valid API calls and merges the results** instead of failing.

`meta_validate_query` lets the model check a combination before spending a call on it.
That is the difference between an assistant that reports "the API returned error 100" and
one that returns your numbers.

---

## How this compares to Meta's own MCP server

Meta ships an official MCP server, hosted at `mcp.facebook.com/ads`. It is a good product.
Here is an honest comparison, because the right choice depends on what you need.

| | Meta's official server | This server | [getmcpads.com](https://www.getmcpads.com) |
|---|---|---|---|
| Hosting | Meta-hosted, remote | **You host it.** stdio, local process | Hosted for you |
| Data path | Through Meta's endpoint | **Direct to the Graph API.** No intermediary | Through our gateway |
| Auth | Meta Business OAuth, 2 clicks | You bring a token, which is more setup (see below) | Hosted OAuth |
| Tools | 29 | **44** (34 read + 10 write) | 44, plus 5 other platforms |
| Writes | Applied directly | **Preview first**, applied only on `confirm: true` | Preview first |
| Metric compatibility | None | **Query planner splits incompatible requests** | Same planner |
| Auditable | No | **Yes.** Apache-2.0, read every line | This server, audited |
| Modifiable | No | **Fork it** | No |
| Help Center search | ✅ | ❌ | ❌ |
| Catalog creation | ✅ | ❌ (catalog *reads* are supported) | ❌ |

**Choose Meta's** if you want the fastest possible setup and don't need to see the code.
**Choose this one** if you need your data to stay on your infrastructure, want to audit or
extend what the model can do, or want writes that can't fire on the first call.
**Choose [getmcpads.com](https://www.getmcpads.com)** if you want this server's capabilities
without running it, or you need more than one ad platform in the same conversation.

---

## Getting a token

This is the one step that takes real effort, and it's worth doing properly.

You need a Meta access token with **`ads_read`**. There are three ways to get one; the
second is the one we recommend.

### Recommended: System User token (does not expire)

A System User belongs to your Business, not to a person. Its token survives password
changes and staff departures, and **needs no App Review** to access ad accounts your
Business already owns.

1. Go to [Business Settings](https://business.facebook.com/settings) → **Users → System Users**
2. **Add** a system user. Give it the *Employee* role unless you need more.
3. **Assign Assets** → select your ad accounts → grant **View performance** (add
   *Manage campaigns* only if you plan to enable writes).
4. **Generate New Token** → pick your app → select scope **`ads_read`**
   (add `ads_management` only for writes).
5. Set the expiry to **Never**.
6. Copy the token. Meta shows it once.

📖 [Meta's System User documentation](https://developers.facebook.com/docs/marketing-api/system-users)

### Quick test: Graph API Explorer (expires in ~1 hour)

Fine for trying the server out, useless for daily work.
[Graph API Explorer](https://developers.facebook.com/tools/explorer/) → select your app →
add `ads_read` → **Generate Access Token**.

### Long-lived user token (~60 days)

Exchange a short-lived token for a 60-day one. You will have to redo this every two months.
📖 [Long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived)

### Which permissions?

| Permission | When you need it |
|---|---|
| `ads_read` | **Always.** Campaigns, insights, everything read-only |
| `ads_management` | Only if you set `META_ENABLE_WRITES=1` |
| `business_management` | Optional. Business Manager asset discovery |
| `pages_show_list`, `pages_read_engagement` | Optional. Page posts and organic enrichment |
| `instagram_basic` | Optional. Linked Instagram accounts |
| `catalog_management` | Optional. Product catalog reads |

Run **`meta_health_check`** as your first call: it reports which scopes you actually have
and which ones are missing for the tools you tried to use, without printing your token.

---

## Setup

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "meta-ads": {
      "command": "npx",
      "args": ["-y", "@getmcpads/meta-ads-mcp-server"],
      "env": {
        "META_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. Ask it: *"list my Meta ad accounts"*.

### Claude Code

```bash
claude mcp add meta-ads --env META_ACCESS_TOKEN=your-token-here -- npx -y @getmcpads/meta-ads-mcp-server
```

### Cursor

`.cursor/mcp.json` in your project, same shape as the Claude Desktop config above.

### From source

```bash
git clone https://github.com/getmcpads-com/meta-ads-mcp-server.git
cd meta-ads-mcp-server
npm install && npm run build
cp .env.example .env   # then fill in META_ACCESS_TOKEN
npm start
```

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `META_ACCESS_TOKEN` | none | **Required.** Your Meta access token |
| `META_ENABLE_WRITES` | *unset* | Set to `1` to register the 10 write tools |
| `META_API_VERSION` | `v26.0` | Graph API version. Override to pin another |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Check your setup at any time:

```bash
npm run doctor
```

---

## Writes, and why they preview first

Write tools are **disabled by default**. Enable them with `META_ENABLE_WRITES=1`.

When enabled, every write tool returns a preview and changes nothing:

```jsonc
// meta_update_adset_budget { adSetId: "123", currency: "EUR", dailyBudget: 50 }
{
  "applied": false,
  "action": "meta_update_adset_budget",
  "change": { "adSet": "123", "field": "daily_budget", "amount": 50,
              "currency": "EUR", "inMinorUnits": 5000 },
  "message": "Preview only, nothing was changed. Repeat the same call with confirm: true to apply this change to the live account."
}
```

Only a second call carrying `confirm: true` touches the live account.

This is deliberate. An assistant composes these calls, and it can pick the wrong account,
the wrong campaign, or the wrong order of magnitude on a budget. A mandatory preview makes
the mistake visible before it costs money, and gives a human the stopping point the
protocol does not guarantee on its own.

Two further guardrails:

- **`meta_create_campaign` always creates the campaign `PAUSED`.** There is no option to
  create it active.
- **Budgets are converted to minor units per currency.** The yen, the won and the CFA franc
  have no subunit, so sending 1250 for ¥12.50 would multiply the spend by a hundred. The
  server knows the zero-decimal currencies.

| Tool | What it changes |
|---|---|
| `meta_update_campaign_status` / `_adset_status` / `_ad_status` | Pause or reactivate |
| `meta_update_campaign_budget` / `_adset_budget` | Daily or lifetime budget |
| `meta_update_adset_schedule` | Start and end time |
| `meta_rename_campaign` / `_adset` / `_ad` | Name only |
| `meta_create_campaign` | Creates a campaign, always `PAUSED` |

---

## Tools

<details>
<summary><b>34 read tools</b></summary>

### Discovery and health
| Tool | Purpose |
|---|---|
| `meta_health_check` | Validates the token, lists accessible accounts, reports missing scopes |
| `meta_debug_token` | Token validity, expiry and granted scopes |
| `meta_list_ad_accounts` | Every ad account the token can reach |
| `meta_get_account_details` | Currency, timezone, spend cap, status, business info |
| `meta_get_business_assets` | Businesses, Pages, Instagram accounts, pixels, datasets |

### Structure
| Tool | Purpose |
|---|---|
| `meta_get_campaigns` / `meta_get_adsets` / `meta_get_ads` | List entities, filterable by parent |
| `meta_get_campaign_structure` | Full hierarchy: campaigns → ad sets → ads |
| `meta_search_entities` | Search by name within an account |
| `meta_get_ad_activity` | Activity log: who changed what, and when |

### Performance
| Tool | Purpose |
|---|---|
| `meta_get_insights` | The main reporting tool. Metrics, breakdowns, attribution windows |
| `meta_validate_query` | Check a metric/breakdown combination *before* running it |
| `meta_get_insights_raw` | Native Insights fields, no aliasing |
| `meta_get_delivery_diagnostics` | Why delivery is limited: statuses and issues |

### Creatives
| Tool | Purpose |
|---|---|
| `meta_get_creatives` | Text, images, videos, links, CTAs |
| `meta_get_creative_assets` | Normalised asset metadata, media URLs, asset feeds |
| `meta_get_ad_preview` | Rendered preview markup for a placement |

### Audiences and targeting
| Tool | Purpose |
|---|---|
| `meta_get_audiences` / `meta_get_audience_details` | Custom, saved and lookalike audiences |
| `meta_search_targeting_options` | Interests, geographies, locales, cities, postal codes |
| `meta_get_brand_safety_controls` | Suitability, placement and context controls |

### Commerce and organic
| Tool | Purpose |
|---|---|
| `meta_get_catalog_products` | Product catalogs and items |
| `meta_join_product_insights` | Product-breakdown insights enriched with catalog metadata |
| `meta_get_pixels` | Pixels and datasets |
| `meta_get_pages` / `meta_get_page_posts` | Pages and their recent posts |
| `meta_get_instagram_accounts` | Linked Instagram accounts |
| `meta_get_organic_content_enrichment` | Media URLs, permalinks, counts for organic content |

### Experiments
| Tool | Purpose |
|---|---|
| `meta_get_ad_studies` | Conversion lift studies and A/B tests |
| `meta_get_study_results` | Detailed study results |
| `meta_interpret_experiment_results` | Results with confidence guardrails |

### Escape hatches
| Tool | Purpose |
|---|---|
| `meta_get_node_fields` | Read flat fields from any Graph node |
| `meta_list_edge_raw` | List an allowlisted Graph edge with your own field selection |

These last two exist so a new Graph field doesn't require a new release. The edge allowlist
deliberately **excludes lead records**, which carry personal data.

</details>

<details>
<summary><b>7 resources</b></summary>

| URI | Contents |
|---|---|
| `meta://manifest` | What this server exposes, and which tool to run first |
| `meta://metrics` | All 190 metrics with categories and formats |
| `meta://breakdowns` | All 56 breakdowns and where they are valid |
| `meta://compatibility` | The compatibility matrix, 90 dimensions |
| `meta://recipes` | 11 step-by-step workflows |
| `meta://p2-readonly` | Read-only scope guidance |
| `meta://app-review` | Scope positioning for a Meta App Review submission |

</details>

---

## Security

The server holds a credential that can read live ad accounts, and modify them when writes
are enabled.
Concretely:

- **The token is never logged**, at any log level, and never written to disk.
- **Requests go only to `graph.facebook.com`** on the pinned version. Any other host is
  refused rather than called. *Covered by tests.*
- **Redirects are refused once a token is attached**, so a redirect cannot forward your
  credential elsewhere. *Covered by tests.*
- **No telemetry.** The server makes no network call other than to the Graph API. There is
  no analytics, no phone-home, and no usage reporting. You can verify this by grepping
  the source for `fetch`.

Full policy and reporting instructions: [SECURITY.md](SECURITY.md).

---

## Looking for a managed, multi-platform version?

This server does one platform, on your machine, with your token. That is on purpose.

If you'd rather not run it yourself, or you need Facebook Ads **alongside Google Ads,
TikTok Ads, Pinterest Ads, GA4 and Search Console** behind one endpoint, with hosted OAuth
and cross-platform reporting, that's what we build at **[getmcpads.com](https://www.getmcpads.com)**.

Same philosophy, less plumbing. This project stays open source and independently useful
either way.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
Please read [SECURITY.md](SECURITY.md) before reporting anything security-related.

## Licence

[Apache License 2.0](LICENSE). See also [NOTICE](NOTICE).

Facebook, Meta, Instagram and the Meta Marketing API are trademarks of Meta Platforms, Inc.
**This project is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.**
It is an independent client of a public API.
