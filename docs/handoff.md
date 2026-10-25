# AI Video Editing Engine — Project Handoff

This document captures the decisions and implementation context from the
project-planning chat so work can continue from another machine. Keep the
project's remaining work and context here instead of scattering TODO lists
across the repository.

Last updated: 2026-10-26

## Project purpose and decisions

- **Canonical name:** AI Video Editing Engine
- **Repository:** `warengonzaga/ai-video-editing-engine` (currently private)
- Build a reliable, reusable video editing engine distilled from the workflow
  demonstrated by Herk Edit Kit. Implement the workflow independently; do not
  copy Herk source files, skills, templates, examples, footage, or brand assets.
- The engine is a local-first Node.js CLI and JavaScript API. It is meant to be
  consumed by future products, not to become the creator-facing product itself.
- Keep media inside isolated per-video project folders. Preserve original media,
  use reviewable edit decision lists (EDLs), and refuse to overwrite existing
  inputs or outputs.
- Do not require an `inbox`/`outbox` handoff workflow. A consumer can provide
  paths and call the CLI/API against a project directory.
- The engine should work for general video formats and custom dimensions, not
  be limited to social-media aspect ratios. Current project defaults are
  1920×1080, with custom canvas width and height supported.
- Keep future `content-creator-kit`, `ai-image-editing-engine`, agent plugins,
  GitHub Repo Banner/image editing, publishing, and social-post workflows out
  of this repository's current scope. They can consume this engine later.
- The user owns the private GitHub repository and intends to make a release
  after the engine is ready. A push to `main` for portability is not a public
  release or package publication. Do not publish, make the repository public,
  or create a release without a later explicit request.

## Workflow and tool choices

The intended editing sequence is:

1. Create a project and inspect the source media.
2. Import a transcript or generate one with an explicitly available provider or
   local model.
3. Propose edits from transcript timing; keep proposals reviewable.
4. Approve an EDL, apply its cuts to a new media file, and retime the transcript
   using the same EDL.
5. Compose visuals/captions with HTML, HyperFrames, and GSAP.
6. Lint, preview, inspect a draft, then render a final output.

Publishing is separate. The currently selected toolchain is Node.js, FFmpeg and
ffprobe, HyperFrames, GSAP, and the browser runtime supported by HyperFrames.
FFmpeg and ffprobe are external executables and must be available on `PATH` for
media operations. HyperFrames uses its supported browser runtime for rendering.
GSAP is installed as a package and copied into newly generated project assets.

Transcription is not guaranteed by installing this engine alone. It needs a
supported HyperFrames transcription backend/provider or a separately installed
local runtime and model. `whisper-cpp`, Kokoro/TTS, MusicGen, and Docker are
optional capabilities, not baseline requirements for every command. Cloud
providers and asset generation should remain opt-in.

## Implemented in the current repository

- ESM package with CLI entry source, module exports, Node.js 22+ requirement,
  exact dependency pins, test and doctor scripts.
- `npm run doctor` checks Node.js, FFmpeg, ffprobe, HyperFrames, and GSAP, then
  displays HyperFrames' own environment checks and install hints.
- Project generator creates isolated `assets`, `transcripts`, `edits`,
  `compositions`, and `renders` folders; writes metadata/config and a basic
  animated HyperFrames composition; supports custom dimensions, fps, and
  duration; refuses an existing project folder.
- Media probe reports duration, dimensions, frame rate, audio/video streams, and
  codecs through ffprobe.
- Versioned transcript schema and normalization for provider word timing and
  imported SRT/VTT/JSON data. Cue-level imports are marked so word-level
  repeated-word analysis can reject them safely.
- HyperFrames transcription and transcript import commands. Import preserves
  the supplied source media and writes the engine's normalized transcript.
- Transcript-derived silence/pause proposals and repeated-word candidates.
  These are suggestions and do not apply cuts automatically.
- Versioned EDL validation, including source duration, ordered non-overlapping
  cuts, valid bounds, and reasons. Transcript retiming drops fully cut words,
  rejects partial-word cuts, and preserves optional granularity metadata.
- FFmpeg cut rendering with synchronized audio/video trim and concat, output
  duration/audio checks, and protection against overwriting the source or an
  existing output.
- HyperFrames lint, preview, and render wrappers. Render output is checked for
  duration and media metadata before it is committed to the requested path.
- README and architecture documentation.

## Current implementation limits

- `plan-silence` uses transcript word gaps to propose trims. It does not analyze
  the waveform to detect acoustic silence.
- `mistake-candidates` currently detects adjacent repeated words only. It does
  not make semantic edit decisions or remove content automatically.
- Project creation produces a small title-card starter composition. It does
  not automatically import source footage, build captions, crop/fit footage to
  the project canvas, or connect an approved EDL cut render to a final
  HyperFrames composition.
- FFmpeg cut rendering and HyperFrames composition rendering work as separate
  operations; a complete one-command source-to-final-video orchestration is not
  implemented yet.
- There is no dedicated provider adapter framework, in-engine transcription
  model, speaker diarization, transcript correction UI, or interactive editor.
- EDLs and outputs are validated, but durable media/transcript/EDL hashes and
  full edit lineage are not written into output metadata yet.
- Custom canvas dimensions are supported, but named platform presets, safe-area
  guides, fit/fill/crop policies, and source-aspect handling are not.
- There is no end-to-end automated test for transcript import. A manual SRT
  import succeeded, but its integration test was removed after HyperFrames on
  Windows returned `EBUSY` while cleaning up the generated project folder.
- Cross-platform validation against Linux/macOS, a range of codecs, variable
  frame-rate inputs, long footage, and real user footage remains outstanding.

## Remaining work

Keep this section as the single backlog. Update checkboxes and details here as
work is completed.

### P0 — Make the engine dependable end to end

- [ ] Add an end-to-end path that creates a project, registers source media,
  imports/generates a transcript, applies an approved EDL, creates a captioned
  composition, and renders one final video.
- [ ] Define how project media is referenced/copied/linked and ensure original
  source files remain immutable.
- [ ] Add explicit fit/fill/crop behavior when source and output aspect ratios
  differ; provide common portrait, landscape, and square presets in addition to
  arbitrary dimensions.
- [ ] Add repeatable import/transcription integration coverage that cleans up
  reliably on Windows, then run the same coverage on Linux and macOS.
- [ ] Validate a short real-footage edit from transcript through final render,
  including audio sync and a human review of the output.
- [ ] Verify the transcript import contract for SRT, VTT, and JSON, including
  cue versus word-level timing and malformed inputs.
- [ ] Test edge cases: no-audio video, audio-only transcript input, one-word
  transcript, empty EDL, cuts at file boundaries, variable-frame-rate footage,
  unsupported codecs, and near-full-duration cuts.

### P1 — Improve edit provenance and transcript quality

- [ ] Add an optional acoustic-silence detector; keep transcript-gap planning as
  a separate, clearly named strategy.
- [ ] Add transcript correction/review artifacts and optional speaker metadata
  without making cloud services mandatory.
- [ ] Define stable project, transcript, EDL, and render metadata contracts,
  including source hashes and the approved EDL identity used for each output.
- [ ] Decide how to handle partial-word cuts, frame-accurate time rounding,
  overlapping transcript timestamps, and audio/video stream offset edge cases.
- [ ] Make project dimensions, fps, duration, and source-media settings
  configurable through a documented API/CLI contract.

### P1 — Make it usable from another project or machine

- [ ] Decide whether distribution is source checkout, Git dependency, or npm
  package. `package.json` is currently `private: true` and has no installed
  executable `bin` mapping, so public npm installation is not enabled.
- [ ] If package distribution is chosen, add a stable CLI executable, package
  file allowlist, install/setup instructions, and a consumer-project example.
- [ ] Document Windows, macOS, and Linux FFmpeg/browser setup and capability
  requirements. Keep optional transcription/model requirements explicit.
- [ ] Add a clean-machine install check that verifies project creation, lint,
  preview, render, and the doctor messages when optional tools are missing.
- [ ] Choose and document the supported Node.js and HyperFrames version policy.
  The current pins are Node.js >=22, HyperFrames 0.7.109, and GSAP 3.14.2.
  The local HyperFrames doctor reports a newer version; upgrade only after
  reviewing compatibility and rerunning smoke tests.

### P2 — Release readiness

- [ ] Add CI for supported Node.js versions/platforms, tests, dependency audit,
  and a minimal render smoke test where the browser runtime is available.
- [ ] Recheck direct/transitive dependency advisories and third-party licenses
  before distributing. Do not copy Herk proprietary/unlicensed assets.
- [ ] Decide repository license, package license, versioning, and release flow.
- [ ] Keep the repository private until the owner explicitly requests a public
  release; do not publish npm artifacts or create a GitHub release early.

## Validation evidence and environment-specific gaps

At the last local verification on 2026-10-26:

- `npm test`: 19 tests passed.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- `npm run doctor`: Node.js 22.22.2, FFmpeg/ffprobe 8.0.1, HyperFrames 0.7.109,
  GSAP installed; required checks passed.
- HyperFrames lint: generated portrait composition had zero errors and warnings.
- Portrait render: 1080×1920, 30 fps, 4 seconds; FFmpeg/ffprobe confirmed H.264
  output and expected duration/dimensions.
- FFmpeg A/V cut integration test passed as part of the test suite.
- Manual SRT import produced a normalized two-cue transcript and preserved the
  source media; automated integration coverage remains outstanding as noted
  above.
- `whisper-cpp`, Kokoro/TTS, and MusicGen were not installed. Docker was
  installed but not running. Therefore local AI transcription and these
  optional render capabilities were not verified.

These results are specific to the machine and dependency versions above. Repeat
the checks after cloning on another machine before relying on its environment.
