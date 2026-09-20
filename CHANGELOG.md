# Changelog
## 2.0.0 - 2026-09-20

- Use account-scoped creative reads compatible with Graph v26, including bounded historical fallback and ownership verification.
- Add exact entity configuration and uploaded-video readiness reads.
- Update campaign creation, budget ownership, schedule validation and post-write verification.
- Require Node.js 22.12 or newer and check Node 22/24 in CI.
- Update vulnerable dependencies and regenerate the MCP catalog.
- No hosted creative UI or MCP Apps integrations.


## 1.1.0

- Synchronize applicable platform features with GetMCPAds commit b1471be while retaining local read-only exploration tools and credential configuration.
- Expose 39 read tools and 23 explicitly enabled write tools.
- Add MCP annotations, parameter descriptions, structured results, server identity and an offline-generated discovery card.
- Preserve preview/confirmation boundaries; test provider request construction and errors with mocked APIs.
- Refuse credential-bearing redirects and document provider-specific limitations.

No live advertiser mutation is performed by the release tests.
