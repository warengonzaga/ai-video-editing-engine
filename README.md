# AIVEE

<p align="center">
  <img src="https://ghrb.waren.build/render/banner?header=AIVEE&amp;subheader=AI%20Video%20Editing%20Engine%20for%20AI%20workflows&amp;bg=0D1117-1B2B4B&amp;color=F0F6FC&amp;subheadercolor=C7D2E5&amp;headerfont=Inter&amp;subheaderfont=Inter" alt="AIVEE — AI Video Editing Engine for AI workflows">
</p>

<p align="center">
  <strong>A local-first video editing CLI and API for AI workflows.</strong><br>
  Build timelines, review edits, compose layers, and render locally.
</p>

## ✨ Features

- **Generic timeline:** editable video, audio, and overlay tracks with validated clips, transitions, keyframes, masks, speech-bubble captions, and other overlays.
- **Media workflow:** register and verify assets, create proxies and previews, inspect scenes, and plan reviewable B-roll edits.
- **Studio workspaces:** initialize per-Studio libraries and create editable projects under a shared, user-selected AIVEE root.
- **Audio and transcripts:** retime word-level transcripts, mix and master audio, apply fades and ducking, and export subtitle files.
- **Rendering:** render MP4, WebM, MOV, GIF, or PNG sequences with progress, cancellation, output checks, and resumable capture checkpoints.
- **Interchange and animation:** optional OpenTimelineIO support, generic timed image layers, and keyframes. Avatar art and speech-driven character animation are owned by consuming studios such as [Explainer Studio](https://github.com/warengonzaga/explainer-studio).
- **AI-ready interfaces:** use the same versioned timeline through the CLI or JavaScript API; proposed content cuts remain reviewable before application.

## 🖥️ Platform Support

Windows and Linux are supported. Windows has a local test and render-smoke
baseline. Linux passed all 137 tests, the full render smoke, and the production
dependency audit in a Debian Bookworm Docker container with Node.js 22, FFmpeg,
and the HyperFrames headless browser. Container rendering used software
graphics. Repository development now uses Bun. The published `aivee` command
still runs on Node.js 22 or newer.

macOS is not officially supported yet. The repository has a manual macOS
workflow option, but native Mac validation is still required. Follow
[issue #2](https://github.com/warengonzaga/ai-video-editing-engine/issues/2) for
that work.

## 🚀 Getting Started

### Requirements

- Bun 1.4.4 for repository development (`packageManager` in `package.json`)
- Node.js 22 or newer to run the published CLI
- FFmpeg and ffprobe
- HyperFrames browser runtime for rendering
- Python and OpenTimelineIO only for timeline interchange

### Install and check the local toolchain

```sh
bun install
bun run doctor
bun src/cli.mjs capabilities
```

Create a project and list the supported canvas presets:

```sh
bun run new-video -- vertical-video 1080x1920 30 15
bun src/cli.mjs presets list
```

After the first release, install the CLI from npm with:

```sh
npm install --global aivee
aivee doctor
```

The published `bin` stays on the Node shebang (`#!/usr/bin/env node`). npm
installs invoke that file with Node, so people who install `aivee` from npm do
not need Bun. Repository scripts run the same file with Bun.

The CLI command is `aivee`. The release workflow publishes the unscoped npm
package `aivee` and the owner-scoped GitHub Packages package
`@warengonzaga/aivee`. npm publishing uses trusted publishing through GitHub
Actions OIDC, so no `NPM_TOKEN` secret is needed. Package artifacts are also
published for pull requests, `dev` pushes, and manual workflow runs. See the
[release guide](docs/releasing.md) for the one-time setup.

## 📖 Usage

Start with the [Video Editing Usage Guide](docs/usage.md) for project creation,
media registration, editing operations, rendering, transcripts, and
OpenTimelineIO interchange.

Related references:

- [Aspect ratio presets](docs/aspect-ratio-presets.md)
- [Architecture and API boundaries](docs/architecture.md)

## 🧪 Development and Validation

Run the automated checks from the repository root:

```sh
bun test
bun run check
bun run test:render-smoke
bun audit --omit=dev
```

`bun test` runs the existing `node:test` files. Bun 1.4 implements the test
APIs this suite uses, including `t.skip()`, `t.after()`, and the `{ skip }`
option, so the tests stay on `node:test` and `node:assert/strict`.

`bun run check` is the Biome lint and format gate. `bun run lint` reports lint
findings, and `bun run format` writes formatting changes. Biome covers
`src/`, `test/`, `scripts/`, and `package.json`.

Build Flow runs on pull requests targeting `dev` or `main`, pushes to `dev` or
`main`, and manual dispatch. Pull requests use the `node-bun` profile: Bun
installs dependencies, Biome checks the tree, and `bun test` runs with FFmpeg
installed. That CI job is the test gate before merge. Package artifacts publish
on pull requests, `dev` pushes, and manual runs. The separate
platform-validation workflow is manual-trigger only; use its selector for
Linux, Windows, macOS, or the full matrix. A native macOS run is still required
before claiming Mac support.

## 🤝 Contributing

Use short-lived feature branches from `dev` and open pull requests targeting
`dev`. Install dependencies with Bun, and run `bun run check` and `bun test`
before opening a pull request. Follow the repository's Clean Commit format and
keep changes focused. Do not create a `dev`-to-`main` pull request without a
release decision.

## 🐛 Issues & Support

Report defects, request capabilities, or track platform validation through
[GitHub Issues](https://github.com/warengonzaga/ai-video-editing-engine/issues).
See [issue #2](https://github.com/warengonzaga/ai-video-editing-engine/issues/2)
for native macOS support validation.

## 📄 License

AIVEE (AI Video Editing Engine) is licensed under the [MIT License](LICENSE). Third-party
dependencies retain their respective licenses.

## 👥 Authors & Contributors

Created and maintained by [Waren Gonzaga](https://github.com/warengonzaga) and
contributors.
