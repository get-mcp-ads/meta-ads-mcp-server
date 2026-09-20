# Publishing releases

GitHub source releases, npm packages and MCP Registry entries have separate publication steps.

1. Merge the reviewed update after CI succeeds. Keep package, server and catalog versions consistent.
2. Publish a GitHub release for that exact commit, with a version tag such as `v2.0.0`, platform-specific notes, upgrade instructions and source installation steps. Mark the current stable release as Latest.
3. Publish the matching npm package through the maintainer's approved npm release process.
4. Run **Publish to MCP Registry** from GitHub Actions and select that existing tag. The workflow validates the tag and both manifests, runs tests, and verifies that the matching npm package exists before registry authentication and publication.

Publishing a GitHub source release does not claim npm or MCP Registry availability. The README distinguishes source installation from package installation.
