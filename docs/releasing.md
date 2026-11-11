# Releasing AIVEE

The `Build Flow` workflow validates pull requests targeting `dev` or `main` and
publishes package artifacts on pull requests, pushes to `dev`, and manual runs.
These preview artifacts go to npm and GitHub Packages. A push to `main` after
merging a release PR publishes the release versions and creates a GitHub Release
after both registries report success. Container publishing is disabled.

Development and CI use Bun 1.4.4 (`bun.lock`) and Biome. The `node-bun` profile
installs dependencies with `bun install --frozen-lockfile`, runs `bun run check`,
and runs `bun test` after FFmpeg is installed. That validate job is the required
test gate before merge. npm trusted publishing stays in place: the package job
still sets up Node.js and npm for the OIDC upload, packs with `bun pm pack` when
the package manager is Bun, and publishes the GitHub Packages copy with Bun.
`release-package-manager` is `bun`.

`build-flow-action` v1.0.2 calls `package-build-flow-action` v2.3.0, which always
runs `scripts.test` during packaging and ignores a failing result. That action
has no input to skip the package-step test run, and the reusable workflow does
not expose one. The package job also does not install FFmpeg, so the repeated
run is noisy and is not the merge gate. Do not remove the `test` script to hide
it; local development and the manual platform workflow use that script.

## One-time setup

1. Configure npm trusted publishing for this GitHub repository and the
   `build-flow.yml` workflow. The workflow uses OIDC; no `NPM_TOKEN` secret is
   required.
2. Allow GitHub Actions to write packages. The workflow uses `GITHUB_TOKEN` to
   publish the GitHub Packages copy.

After setup, release promotion from `dev` to `main` runs the version, package,
and GitHub Release flow. Check both registries after the first automated release;
publishing to them is not atomic.
