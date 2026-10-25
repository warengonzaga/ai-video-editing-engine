# AI Video Editing Engine

A local-first, standalone engine for transcript-driven video editing and
motion-graphics rendering.

This project takes inspiration from the workflow in Herk Edit Kit while building
an independent implementation. It reuses the same core toolchain—Node.js,
FFmpeg/ffprobe, HyperFrames, and GSAP—without copying Herk Edit Kit source files,
skills, templates, examples, or media.

This repository contains the reusable engine only. Agent plugins and end-user
creator workflows belong in separate consumer projects and can call the engine
through its CLI or package interface.

## Design goals

- Keep original media immutable and all edit artifacts inside a project folder.
- Normalize provider transcripts into one validated, word-timed format.
- Represent every cut as a reviewable edit decision list (EDL) with source-time
  provenance, then retime transcript words from that same EDL.
- Keep creative workflows separate from the reusable media and render engine.
- Run locally by default; make cloud transcription or asset generation opt-in.
- Validate project structure and timing before preview or render.

## Requirements

- Node.js 22 or newer
- FFmpeg and ffprobe for probing and cutting media
- HyperFrames and its supported browser runtime for HTML-to-video rendering
- GSAP for the generated starter composition

Run `npm install`, then `npm run doctor` to check the local toolchain. The doctor
reports missing required tools and HyperFrames' optional local AI runtimes.
Transcription requires a supported provider or local model/runtime; importing an
existing SRT, VTT, or JSON transcript does not.

## Create a project

```sh
npm run new-video -- my-video
npm run new-video -- vertical-video 1080x1920 30 15
```

The default canvas is 1920×1080 at 30 fps for 10 seconds. Width, height, frame
rate, and duration are configurable; examples include `1080x1920` for portrait
and `1080x1080` for square. Projects are created under `video-projects/` and
existing project folders are never overwritten.

## Editing workflow

```sh
# Inspect media and create a project
node src/cli.mjs probe path/to/source.mp4
node src/cli.mjs project create my-video 1080x1920 30 15

# Create or import a transcript
node src/cli.mjs transcribe video-projects/my-video path/to/source.mp4
node src/cli.mjs import-transcript video-projects/my-video path/to/source.mp4 path/to/captions.srt

# Propose edits, review the EDL, then apply approved cuts
node src/cli.mjs plan-silence video-projects/my-video/transcripts/transcript.json video-projects/my-video/edits/silence-edl.json
node src/cli.mjs mistake-candidates video-projects/my-video/transcripts/transcript.json
node src/cli.mjs apply-edl path/to/source.mp4 path/to/approved-edl.json path/to/clean-cut.mp4
node src/cli.mjs retime video-projects/my-video/transcripts/transcript.json path/to/approved-edl.json video-projects/my-video/transcripts/retimed.json

# Lint, preview, and render the composition
node src/cli.mjs lint video-projects/my-video
node src/cli.mjs preview video-projects/my-video
node src/cli.mjs render video-projects/my-video
```

Silence and repeated-word detection produce proposals only. Review and save the
approved cuts in the versioned EDL format before applying them. Source media,
transcripts, EDLs, and render outputs are kept separate; commands refuse to
overwrite existing outputs.

The CLI and JavaScript package exports are the engine interface. Editing agents,
plugins, and creator-facing workflows can be built as separate consumers. See
[`docs/architecture.md`](docs/architecture.md) for contracts and runtime
requirements, and [`docs/handoff.md`](docs/handoff.md) for the full project
context, validation state, and consolidated remaining-work checklist.
