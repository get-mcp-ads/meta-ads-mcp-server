# Publishing releases

A version tag publishes a release. The `release.yml` workflow publishes npm, then the GitHub release, then the MCP Registry entry, in the order the registry requires.

1. Merge the reviewed update after CI succeeds. `package.json`, `server.json` and `src/server.ts` carry the same version, `CHANGELOG.md` has a `## X.Y.Z - YYYY-MM-DD` section for it, and `server-card.json` is regenerated with `npm run catalog`.
2. Tag the merge commit on `main` with `vX.Y.Z` and push the tag.
3. The workflow checks out the tag, installs with `npm ci`, audits runtime dependencies, runs the type check, the build and the tests, and checks that the tag matches `package.json`.
4. It publishes the package to npm with provenance through trusted publishing. No npm token is stored in the repository: the package needs a trusted publisher on npmjs.com that names this repository and the `release.yml` workflow file.
5. It creates the GitHub release for the tag, marked as Latest, with the matching `CHANGELOG.md` section as its notes.
6. It publishes `server.json` to the MCP Registry, authenticated through the getmcpads.com domain with the `MCP_DNS_PRIVATE_KEY` secret. The registry reads `mcpName` from the npm package published in step 4.

Each step skips cleanly when its target already holds the version, so rerunning a partial release is safe. To rerun a release, start **Release** from GitHub Actions and enter the existing tag.

The README distinguishes source installation from package installation, because the GitHub tag can exist before npm and the registry list the version.

Before tagging, add the release to CHANGELOG.md as `## X.Y.Z - YYYY-MM-DD - Title`, then run `npm run release-history`. The README shows every release from the changelog, and the test suite fails when it falls behind.
