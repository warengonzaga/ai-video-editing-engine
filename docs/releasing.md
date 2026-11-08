# Releasing AIVEE

The `Build Flow` workflow runs validation on pull requests and `dev`, then
publishes `aivee` to npm and `@warengonzaga/aivee` to GitHub Packages from
`main`. It creates a GitHub Release after both registries report success.
Development, pull-request, and manual runs do not publish packages.

## One-time npm setup

1. Confirm `aivee` is available on npm and review the package contents with
   `npm pack --dry-run`.
2. Publish the first package version interactively from the reviewed tarball.
   npm trusted publishing cannot bootstrap a package that does not exist yet.
3. Configure npm Trusted Publishing for GitHub owner `warengonzaga`, repository
   `ai-video-editing-engine`, and workflow filename `build-flow.yml`. Allow
   direct publishing and keep two-factor authentication enabled.
4. Enable GitHub Actions package write access for the repository. The workflow
   uses `GITHUB_TOKEN` to publish the GitHub Packages copy.

After setup, release promotion from `dev` to `main` runs the version, package,
and GitHub Release flow. Check both registries after the first automated release;
publishing to them is not atomic.
