# Releasing AIVEE

The `Build Flow` workflow validates pull requests targeting `dev` or `main` and
publishes package artifacts on pull requests, pushes to `dev`, and manual runs.
These preview artifacts go to npm and GitHub Packages. A push to `main` after
merging a release PR publishes the release versions and creates a GitHub Release
after both registries report success. Container publishing is disabled.

## One-time setup

1. Configure npm trusted publishing for this GitHub repository and the
   `build-flow.yml` workflow. The workflow uses OIDC; no `NPM_TOKEN` secret is
   required.
2. Allow GitHub Actions to write packages. The workflow uses `GITHUB_TOKEN` to
   publish the GitHub Packages copy.

After setup, release promotion from `dev` to `main` runs the version, package,
and GitHub Release flow. Check both registries after the first automated release;
publishing to them is not atomic.
