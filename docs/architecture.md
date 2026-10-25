# Architecture

## What to carry forward

Herk Edit Kit demonstrates a useful editing sequence: preserve source media,
transcribe into word-level timestamps, propose cuts, review decisions, retime
the transcript, compose visuals, then lint, preview, and inspect a draft before
rendering the final output. Its local HyperFrames and GSAP workflow also gives
this project a concrete renderer to build around.

We will implement the workflow independently. No source files, skills, card
library, brand assets, footage, or examples are copied into this repository.
If a future change ports or adapts upstream material, review its license and
third-party notices first and preserve the required attribution.

## Improvement targets

1. **Provider-neutral transcription:** one normalized transcript contract, with
   provider-specific adapters and a local option.
2. **Traceable edits:** every cut keeps original source times and a reason; all
   derived media and transcript timings identify the EDL used to produce them.
3. **Safer defaults:** never overwrite source media; require an explicit review
   artifact before applying proposed content cuts; keep credentials and personal
   media out of version control.
4. **Smaller reusable core:** separate media operations and validation from
   assistant instructions, creative styles, and project examples.
5. **Verifiable output:** make machine checks catch structural and timing errors,
   while keeping rendered audio and visual review as a human step.

These targets define this repository's engine scope. Consumer products, plugins,
image editing, asset-generation marketplaces, and large bundled style libraries
belong elsewhere.

## Current implementation

```text
src/
  transcript/   normalized word timing and validation
  edits/        silence proposals, mistake candidates, EDL retiming
  media/        FFmpeg/ffprobe process helpers
  project/      isolated project generation
  render/       HyperFrames lint, preview, transcription, and render
  cli.mjs       command-line interface
video-projects/ generated per-video workspaces
```

The engine creates projects at caller-selected dimensions, imports or generates
transcripts, proposes editable cuts, applies approved EDLs to media, retimes
transcripts, and lints/previews/renders HyperFrames compositions. The generated
starter composition is intentionally small; editing intelligence and user
approval stay outside the renderer.

## Version 1 data contracts

Transcript JSON uses `schemaVersion: 1`, `durationSeconds`, and `words` with
`text`, `start`, and `end` fields. Times are seconds on the original media
timeline. Words must be ordered by start time and stay within the media duration.

An approved EDL uses `schemaVersion: 1`, the same `sourceDurationSeconds`, and a
`cuts` array. Each cut has `sourceStart`, `sourceEnd`, and a non-empty `reason`.
Cuts must be ordered, non-overlapping, positive-duration intervals within the
source. A cut may fully contain a transcript word, removing it. It may not split
a word; rejecting partial-word cuts prevents the retimed transcript from claiming
that clipped speech is intact.

The retimer verifies both contracts and matching source durations before writing
anything. It drops fully cut words and shifts retained timestamps by the removed
duration preceding each word. Source transcript and EDL files are never modified.

## Tool boundary

- Node.js owns the CLI, validation, orchestration, and file handling.
- FFmpeg and ffprobe handle media probing, cuts, and encoding.
- HyperFrames renders HTML compositions; its supported browser runtime is part
  of the render environment.
- GSAP adds timeline animation to compositions; static compositions do not need it.
- Playwright is for browser automation and smoke checks, not required by the
  transcript/EDL core or every render.
- Transcription providers are optional adapters; credentials never enter project
  metadata, generated HTML, logs, or committed files.

## Runtime requirements by capability

| Capability | Requirements |
| --- | --- |
| Transcript and EDL validation/retiming | Node.js 22+; current code uses built-ins only |
| Probe, cut, and encode media | FFmpeg and ffprobe |
| Render HTML compositions | HyperFrames, FFmpeg, and the browser runtime supported by the pinned HyperFrames version |
| Animate compositions | GSAP, when the composition uses animation |
| Automated browser smoke checks | Playwright, when those checks are enabled |
| Generate a transcript | Optional cloud provider key, or a separately installed local transcription runtime and model |
| Reproducible container rendering | Docker, if selected for the render workflow |

The engine checks the tools needed by the requested operation. For example,
transcript retiming does not require FFmpeg, a browser, or API keys. `npm run
doctor` checks Node.js, FFmpeg, ffprobe, HyperFrames, and GSAP, then runs
HyperFrames' environment doctor for browser/render setup and optional local AI
runtimes.

Pinned package versions are an initial baseline from the installed Herk Edit Kit
setup, not a promise of compatibility with future releases. Recheck versions and
licenses before upgrades or distributing a build.
