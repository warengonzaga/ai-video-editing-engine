# AI Video Editing Engine

<p align="center">
  <img src="https://ghrb.waren.build/render/banner?header=AI%20Video%20Editing%20Engine&amp;subheader=Generic%20video%20editing%20engine%20for%20AI%20workflows&amp;bg=0D1117-1B2B4B&amp;color=F0F6FC&amp;subheadercolor=C7D2E5&amp;headerfont=Inter&amp;subheaderfont=Inter" alt="AI Video Editing Engine — Generic video editing engine for AI workflows">
</p>

<p align="center">
  <strong>A local-first video editing runtime and API for AI workflows.</strong><br>
  Build timelines, review edits, compose layers, and render with Node.js.
</p>

## ✨ Features

- **Generic timeline:** editable video, audio, and overlay tracks with validated clips, transitions, keyframes, masks, and captions.
- **Media workflow:** register and verify assets, create proxies and previews, inspect scenes, and plan reviewable B-roll edits.
- **Audio and transcripts:** retime word-level transcripts, mix and master audio, apply fades and ducking, and export subtitle files.
- **Rendering:** render MP4, WebM, MOV, GIF, or PNG sequences with progress, cancellation, output checks, and resumable capture checkpoints.
- **Interchange and animation:** optional OpenTimelineIO support and consumer-neutral avatar/lip-sync composition.
- **AI-ready interfaces:** use the same versioned timeline through the CLI or JavaScript API; proposed content cuts remain reviewable before application.

## 🖥️ Platform Support

Windows and Linux are supported. Windows has a local test and render-smoke
baseline. Linux passed all 137 tests, the full render smoke, and the production
dependency audit in a Debian Bookworm Docker container with Node.js 22, FFmpeg,
and the HyperFrames headless browser. Container rendering used software
graphics.

macOS is not officially supported yet. The repository has a manual macOS
workflow option, but native Mac validation is still required. Follow
[issue #2](https://github.com/warengonzaga/ai-video-editing-engine/issues/2) for
that work.

## 🚀 Getting Started

### Requirements

- Node.js 22 or newer
- FFmpeg and ffprobe
- HyperFrames browser runtime for rendering
- Python and OpenTimelineIO only for timeline interchange

### Install and check the local toolchain

```sh
npm install
npm run doctor
node src/cli.mjs capabilities
```

Create a project and list the supported canvas presets:

```sh
npm run new-video -- vertical-video 1080x1920 30 15
node src/cli.mjs presets list
```

The package is private and is not published to npm. This repository is the
source checkout for development and local/Git-based consumers.

## 📖 Usage

Start with the [Video Editing Usage Guide](docs/usage.md) for project creation,
media registration, editing operations, rendering, transcripts, avatar
composition, and OpenTimelineIO interchange.

Related references:

- [Aspect ratio presets](docs/aspect-ratio-presets.md)
- [Avatar mouth-pack requirements](docs/avatar-mouth-packs.md)
- [Architecture and API boundaries](docs/architecture.md)
- [Implementation plan and validation status](docs/implementation-plan.md)
- [Project handoff and known limits](docs/handoff.md)

## 🧪 Development and Validation

Run the automated checks from the repository root:

```sh
npm test
npm run test:render-smoke
npm audit --omit=dev
```

GitHub Actions are manual-trigger only. Use the platform selector for Linux,
Windows, macOS, or the full matrix. A native macOS run is still required before
claiming Mac support.

## 🤝 Contributing

Use short-lived feature branches from `dev` and open pull requests targeting
`dev`. Follow the repository's Clean Commit format and keep changes focused. Do
not create a `dev`-to-`main` pull request without a release decision.

## 🐛 Issues & Support

Report defects, request capabilities, or track platform validation through
[GitHub Issues](https://github.com/warengonzaga/ai-video-editing-engine/issues).
See [issue #2](https://github.com/warengonzaga/ai-video-editing-engine/issues/2)
for native macOS support validation.

## 📄 License

AI Video Editing Engine is licensed under the [MIT License](LICENSE). Third-party
dependencies retain their respective licenses.

## 👥 Authors & Contributors

Created and maintained by [Waren Gonzaga](https://github.com/warengonzaga) and
contributors.
