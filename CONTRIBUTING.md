# Contributing

Thanks for considering a contribution. This project is maintained by
[GetMCPAds](https://www.getmcpads.com) and is open to outside patches.

## Getting set up

```bash
git clone https://github.com/get-mcp-ads/meta-ads-mcp-server.git
cd meta-ads-mcp-server
npm install
cp .env.example .env
```

Then run the checks:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass. CI runs them on Node 22, 24 and 26.

## Ground rules

**Never commit a token.** `.env` is gitignored. Before opening a PR, re-read
your diff for anything starting with `EAA`, which is the prefix of a Meta
access token.

**Tests use recorded or synthetic data.** Do not add a test that needs live
credentials to pass; CI has none.

**Metric and breakdown catalogues are the load-bearing part.** If you add or
change an entry in `metric-catalog.ts`, `breakdown-catalog.ts`,
`dimension-catalog.ts` or `compatibility-rules.ts`, say in the PR description
where the rule comes from: a link to the Meta documentation, or the API error
you observed. A plausible-looking rule that is wrong is worse than a missing
one, because the query planner trusts it.

**Write tools must preview first.** Any new write tool has to accept `confirm`
and return a preview when it is absent. A tool that mutates an account on the
first call will not be merged.

**Keep it self-contained.** Runtime dependencies are `@modelcontextprotocol/sdk`
and `zod`. Adding a third needs a good reason.

## Pinned API version

The Graph API version is pinned in `src/platforms/meta/client.ts`
(`DEFAULT_API_VERSION`). We move it deliberately, not automatically, because a
version bump can silently change the shape of a response. If you bump it,
describe what you checked.

## Commit and PR style

- One logical change per PR.
- Explain *why*, not just *what*. The diff already says what.
- If you fix a bug, add the test that would have caught it.

## Reporting bugs

Open an issue with: what you called, what you expected, what you got, and the
Graph API version in use. Redact IDs and tokens.

For anything security-related, do not open an issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as stated in [LICENSE](LICENSE).
