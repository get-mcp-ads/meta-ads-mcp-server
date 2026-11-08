# Security Policy

This server holds an access token that can read live advertising accounts, and modify
them when writes are enabled. We take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:
[Report a vulnerability](https://github.com/get-mcp-ads/meta-ads-mcp-server/security/advisories/new).

We aim to acknowledge a report within 3 business days and to ship a fix or a
documented mitigation within 30 days. We will credit you in the advisory unless
you ask us not to.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅        |
| 1.x     | ✅        |

## What this server does with your token

- The token is read **once** from `META_ACCESS_TOKEN` at startup and kept in
  memory. It is never written to disk and never logged, including at
  `LOG_LEVEL=debug`.
- Requests go only to `graph.facebook.com`, on the pinned API version. A
  request to any other host is refused rather than sent, so a token cannot be
  leaked by a crafted path or parameter. This is covered by tests.
- HTTP redirects are refused once a token has been attached, so a redirect
  cannot forward your credentials to a third party. This is covered by tests.
- No telemetry, no analytics, no phone-home. The server makes no network call
  other than to the Graph API.

## Handling your token safely

- Prefer a **System User token** scoped to the smallest set of ad accounts you
  actually need.
- Grant `ads_read` only. Add `ads_management` **only** if you enable writes.
- Treat the token like a password: it is a bearer credential. Anyone holding it
  has your permissions.
- Your MCP client config file is usually plain text on disk. Check its
  permissions, and never commit it.
- Rotate the token if you suspect exposure. Meta lets you revoke a System User token
  from Business Settings immediately.

## Scope

Vulnerabilities in the Meta Graph API itself are not in scope here; report those
to [Meta's bug bounty programme](https://www.facebook.com/whitehat).
