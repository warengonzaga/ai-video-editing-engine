# Releasing AIVEE

The `Build Flow` workflow validates pull requests targeting `dev` or `main`.
Merging the release pull request to `main` publishes `aivee` to npm and
`@warengonzaga/aivee` to GitHub Packages, then creates a GitHub Release after
both registries report success. Development, pull-request, and manual runs do
not publish packages.

## One-time setup

1. Add an npm automation token with publish access as the repository secret
   `NPM_TOKEN`. The workflow uses it to create the initial npm package and to
   publish later versions.
2. Enable GitHub Actions package write access for the repository. The workflow
   uses `GITHUB_TOKEN` to publish the GitHub Packages copy.

After setup, release promotion from `dev` to `main` runs the version, package,
and GitHub Release flow. Check both registries after the first automated release;
publishing to them is not atomic.
