# AI Video Editing Engine

A local-first, standalone video editing engine with a versioned timeline,
media registration, transcript-assisted edits, captions, audio tracks, and
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
Rhubarb Lip Sync is also detected as an optional external CLI; install it
separately if you want phonetic mouth cues.
Transcription requires a supported provider or local model/runtime; importing an
existing SRT, VTT, or JSON transcript does not.
Consumers can check the same environment programmatically with
`getEngineCapabilities()` or print its versioned JSON contract from the CLI:

```sh
node src/cli.mjs capabilities
```

The report includes required tool availability, common input containers and
video/audio decoders, output formats with detected codec and per-format
color-profile support, named canvas presets, optional filters used by
specific render features, and the generic phonetic avatar sprite contract.
Browser runtime availability is intentionally reported as unchecked; run
`npm run doctor` to let HyperFrames inspect the local render environment.
The JavaScript API also exposes `listFfmpegDecoders()` and
`listFfmpegDemuxers()` plus `has` and `assert` helpers for checking a specific
input capability before accepting media.
To inspect an audio/video source against the local FFmpeg build before ingesting
it, run `node src/cli.mjs media support <media>` or call
`inspectMediaCompatibility(mediaPath)` from the JavaScript API. The report
checks the container and every detected audio/video stream, but does not decode
the full file. Each stream entry includes `index` (the zero-based ordinal used
by timeline selection) and `streamIndex` (the FFmpeg-global stream index). Still
images use the image asset-ingest path. The read-only `media list` API and CLI
normalize older registered metadata to the same ordinal/global index shape
without rewriting project manifests.
Consumers can read the required A-H mouth shapes, X
rest shape, shared-canvas and distinct-image requirements, the default GHX
extended-shape setting, and whether the Rhubarb adapter is installed instead
of hard-coding Engine-specific avatar assumptions.

The package exposes an `ai-video-engine` CLI binary for local or Git-based
consumer installs. The repository remains private and is not configured for
public npm publication.

## Verify the local engine

```sh
npm test
npm run test:render-smoke
```

The render smoke generates temporary VFR footage and narration with matching
visual and audio cues, builds a captioned timeline, and verifies a real
HyperFrames render, including output dimensions, duration, codecs, frame rate,
audio level, source timestamp variability, and cue synchronization. It removes
its temporary project after success and retains it after a failure for debugging.
The smoke also checks Rec.2020 SDR output metadata, video-only rendering with
no audio stream, and audio-only rendering with an audio stream. Its decoded
audio samples are compared with the source tones to verify voice gain,
sidechain ducking, and music recovery; the video cue is checked against its
expected audio-sample and output-frame positions. A separate 12-second CFR
render places matching cues near the beginning and end to measure A/V drift.
The main scene also combines VFR footage, proxy-backed B-roll, a still image,
a nested HyperFrames composition, captions, and narration, then samples rendered
pixels to verify the overlaid layers.

## Generate speech mouth cues

The optional `lip-sync` command calls an installed Rhubarb Lip Sync CLI and
converts its JSON output into the Engine's validated animation-cue format.
FFmpeg converts supported audio inputs to mono WAV for Rhubarb. The Engine does
not install or bundle Rhubarb. The default `phonetic` recognizer works across
languages, though its results are less precise than English PocketSphinx;
supply a dialog file when available to help recognition. Rhubarb can return
shape states `a`–`h` and `x`; Engine avatar composition requires matching
sprite states for all of them before rendering. The default extended-shape
setting is `GHX`.
See the [Rhubarb usage guide](https://github.com/DanielSWolf/rhubarb-lip-sync)
and [license](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/LICENSE.md).

```sh
node src/cli.mjs lip-sync Voice.mp3 mouth-cues.json lip-sync-options.json
```

```json
{
  "rhubarb": "rhubarb",
  "recognizer": "phonetic",
  "extendedShapes": "GHX",
  "dialogFile": "script.txt",
  "spriteStateMap": {
    "a": "a",
    "b": "b",
    "c": "c",
    "d": "d",
    "e": "e",
    "f": "f",
    "g": "g",
    "h": "h",
    "x": "default"
  }
}
```

The JavaScript API exports `rhubarbLipSyncCues(audioPath, options)`. This
produces timing and mouth labels; it does not generate avatar art or guarantee
viseme recognition accuracy.

Avatar-generation workflows can call `validateRhubarbSpriteStates(states,
options)` before saving or using a mouth pack. It throws when any required shape
is missing, mapped to the same state as another shape, or backed by an
incomplete/corrupt PNG, a different canvas size, or byte-identical image
content to another required shape. This catches malformed image data,
inconsistent canvases, reused, or duplicated files, but cannot judge perceptual
similarity, mouth placement within the canvas, or whether the artwork matches
the intended phoneme; those still need visual review.
`avatar-compose` also checks every sprite file and confirms that states on a
layer share the same PNG canvas dimensions before it invokes Rhubarb, so broken
assets fail before cue generation.

For a generation workflow that needs to validate sprites before creating a
project, save a mouth-pack JSON with `states` and optional Rhubarb `options`,
then run:

```sh
node src/cli.mjs avatar validate-mouth-pack mouth-pack.json
```

Relative sprite paths resolve from the JSON file's directory. The command
returns the validated shape-to-state mapping and shared canvas dimensions; it
does not create or modify files.

```js
import { validateRhubarbSpriteStates } from 'ai-video-editing-engine';

validateRhubarbSpriteStates({
  a: 'mouth-a.png',
  b: 'mouth-b.png',
  c: 'mouth-c.png',
  d: 'mouth-d.png',
  e: 'mouth-e.png',
  f: 'mouth-f.png',
  g: 'mouth-g.png',
  h: 'mouth-h.png',
  default: 'mouth-rest.png',
});
```

Use `mapRhubarbCuesToSpriteStates(track, mapping)` to adapt Rhubarb labels to a
sprite pack's available states. The default mapping preserves A-H as distinct
lowercase states and maps X to `default`; consumers can provide their own
lowercase Rhubarb-label-to-state mapping when their artwork uses different
mouth-shape names. The same `spriteStateMap` can go in the lip-sync options
file to write mapped cues directly from the CLI.

For sprite avatars, `createAvatarComposition(projectPath, spec)` accepts
consumer-supplied image layers and state cue tracks. Each layer's default image
is restored when a timed cue ends, so sparse blink or expression cues return to
the default state. Use `audioLevelCues` for a rough audio-reactive mouth demo or
map cues from a speech recognizer onto the sprite states your asset pack has.
To generate mouth cues as part of composition, set `lipSync` to an audio path,
the name of a mouth layer, and optional Rhubarb options. The selected mouth
layer must provide its sprite states and omit a precomputed `track`. The audio
is also used as narration unless `narration` is set separately. Rhubarb must be
installed by the consumer; this convenience does not bundle the optional tool.
Phonetic avatar composition requires distinct A-H mouth sprites and a default
X/rest sprite. Rhubarb generates G/H by default; the avatar pack contract keeps
them required even when a consumer chooses a reduced cue set. A custom
`spriteStateMap` may rename states but cannot map multiple required shapes to
the same sprite state.
This lets a consumer create and render a speech-driven avatar from one
`avatar-compose` specification instead of writing an intermediate cue file.
Composition files, narration, and new sprites are staged before publishing;
`index.html` is replaced last so a failed composition does not leave a partial
scene mounted in the project. Copied asset URLs are percent-encoded so filenames
with URL-reserved characters remain valid in the generated HTML.
For example, the spec can supply a body track and mouth sprites while asking
the Engine to generate the mouth track:

```json
{
  "durationSeconds": 11.133333,
  "lipSync": {
    "audioPath": "Voice.mp3",
    "layer": "mouth",
    "options": {
      "rhubarb": "rhubarb",
      "recognizer": "phonetic",
      "spriteStateMap": {
        "a": "a",
        "b": "b",
        "c": "c",
        "d": "d",
        "e": "e",
        "f": "f",
        "g": "g",
        "h": "h",
        "x": "default"
      }
    }
  },
  "layers": [
    {
      "name": "body",
      "role": "body",
      "image": "assets/avatar/body.png",
      "track": { "schemaVersion": 1, "durationSeconds": 11.133333, "cues": [] }
    },
    {
      "name": "mouth",
      "role": "mouth",
      "image": "assets/avatar/mouth-x.png",
      "states": {
        "a": "assets/avatar/mouth-a.png",
        "b": "assets/avatar/mouth-b.png",
        "c": "assets/avatar/mouth-c.png",
        "d": "assets/avatar/mouth-d.png",
        "e": "assets/avatar/mouth-e.png",
        "f": "assets/avatar/mouth-f.png",
        "g": "assets/avatar/mouth-g.png",
        "h": "assets/avatar/mouth-h.png"
      },
      "x": 0.5,
      "y": 0.4,
      "width": 0.04
    }
  ]
}
```

Run it with `node src/cli.mjs avatar-compose video-projects/my-video avatar.json`.
Layers can use normalized canvas coordinates (`x`, `y`, `width`) or anchor to an
earlier layer with `relativeTo`, `anchor: [x, y]`, and a `width` fraction of the
parent sprite. This keeps face features aligned when the avatar is resized or
moved. Every state in a layer must use the same PNG canvas dimensions, which
prevents blink, mouth, and pose changes from shifting the layer bounds. The
Engine preflights generated sprite destinations and refuses to reuse a
same-named project sprite if its image content differs from the requested
source. The Engine does not bundle avatar artwork or claim phoneme-accurate lip
sync.

## Create a project

```sh
npm run new-video -- my-video
npm run new-video -- vertical-video 1080x1920 30 15
npm run new-video -- short-video --preset vertical --fit cover
node src/cli.mjs presets list
```

The default canvas is 1920×1080 at 30 fps for 10 seconds. Named presets are
`vertical` (9:16), `portrait-feed` (4:5), `square` (1:1), and `landscape`
(16:9). Use `presets list` to inspect their default dimensions and destinations.
Custom dimensions remain available with `WIDTHxHEIGHT`. A preset is recorded as
`canvasPreset` in project metadata. See
[`docs/aspect-ratio-presets.md`](docs/aspect-ratio-presets.md) for the baseline
and platform references. Source media uses `contain` by default to preserve the
whole frame; select `cover` to crop overflow or `fill` to stretch. Set a
project-wide policy with `--fit`, then override it for individual video clips
with their `fit` field. Projects are created under `video-projects/` and
existing project folders are never overwritten. Each project starts with a
valid `timeline.json` containing ordered video, audio, and overlay tracks plus
all currently registered project assets. For an existing project missing that
file, initialize one from its metadata and media catalog with:

```sh
node src/cli.mjs timeline create video-projects/my-video
```

Use the reviewable `set-project-state` operation to change timeline duration or
the project-wide `sourceFit`; validation refuses a duration that would clip
any existing timeline item. `sourceFit: null` clears the project override.
Canvas width, height, and frame rate remain tied to project metadata and are
not editable through a timeline-only operation.

```json
{ "type": "set-project-state", "state": { "sourceFit": "cover", "durationSeconds": 30 } }
```

The optional output path can create a separate timeline. Pass a duration as the
second argument to keep the default output path, or as the final argument after
an output path to override the project default.

Frame rates accept integers and rational values such as `30000/1001` for
NTSC-style 29.97 fps. Rendering passes the project frame rate to HyperFrames
and checks the output rate. Select MP4, WebM, MOV, or GIF by the output file
extension:

```sh
node src/cli.mjs render video-projects/my-video renders/final.webm high
node src/cli.mjs timeline render video-projects/my-video timeline.json renders/final.mov standard
node src/cli.mjs timeline render video-projects/my-video timeline.json renders/final.mp4 high render-options.json
node src/cli.mjs render video-projects/my-video renders/frames high png-options.json
```

`render-options.json` can choose a video `codec`, integer encoder `crf`, or
`videoBitrate`, for example `{ "encoder": { "codec": "h265", "crf": 26 } }`
or `{ "encoder": { "codec": "vp9", "videoBitrate": "8M" } }`. Bound
render resources with `{ "workers": 2, "lowMemoryMode": true }`; `workers`
also accepts `"auto"`, while numeric values must be 1–64. MP4 supports
H.264/H.265, MOV supports H.264/H.265/ProRes, and WebM supports VP9. ProRes
uses its HQ profile and does not accept CRF or bitrate overrides. The codec
override runs as a verified FFmpeg final encode. With an explicit codec and no
CRF/bitrate override, FFmpeg's codec default is used. Add `"timeoutSeconds": 900`
to bound rendering (1–86400 seconds). `renderTimelineAsync` includes FFmpeg
audio alignment, speed/reverse/effect proxy generation, sidechain processing,
HyperFrames capture, final encoding, output probing, and audio mastering in
that deadline. `renderProjectAsync` also applies cancellation and timeouts to
capture, final encoding, and output probing. Timeout terminates the active
media process and removes temporary output. The JavaScript async APIs
`renderProjectAsync`, `renderTimelineAsync`, and `renderEditedProjectAsync` accept an
`AbortSignal` as `signal`. CLI renders handle Ctrl+C by cancelling the active
render and its FFmpeg preprocessing processes. The synchronous `renderProject`
and `renderTimeline` APIs remain available without cancellation. To render PNG
frames, set
`{ "format": "png-sequence" }`; the output path is a new directory. Defaults
remain controlled by HyperFrames quality (`draft`, `standard`, or `high`).
Set `"colorProfile": "rec709"` or `"colorProfile": "rec2020-sdr"` to convert
the rendered SDR video from the renderer's BT.709 working output and write
matching color metadata. This requires FFmpeg's `colorspace` filter and
performs a final video encode. Set `"colorProfile": "hdr10"` for MP4 or MOV to
convert the BT.709 SDR render to 10-bit BT.2020/PQ and encode with HEVC Main 10.
This SDR-to-HDR conversion maps reference white to 203 nits; it cannot recover
highlight detail absent from the SDR render. HDR10 output requires FFmpeg's
`zscale` filter and `libx265`. `npm run doctor` reports filter and encoder
availability. Before rendering, the Engine checks required final encoders and
filters and reports a setup error before generating timeline proxies or
starting browser capture when one is missing.

For long renders, add `{ "resumeCheckpoint": true }` to the render options.
After a complete HyperFrames capture, the async renderer keeps a validated
intermediate if final encoding is interrupted or fails; retry the same render
to reuse it. The cache is content-fingerprinted, SHA-256 checked, removed after
success, limited to 8 GiB per capture by default, and expires after 72 hours.
Override those bounds with `checkpointMaxBytes` (1 MiB–100 GiB) and
`checkpointMaxAgeHours` (1–720). An interruption during browser capture still
requires that capture stage to run again. PNG sequences and synchronous render
APIs do not support checkpoints.

`createCaptionTrack` also accepts reusable text styling options such as
`fontFamily`, `fontWeight`, `lineHeight`, `verticalAlign`, `paddingPixels`,
`textOutline`, and `textShadow`. These settings compile to validated CSS values;
raw CSS is not accepted. `textOutline` uses `{ color, widthPixels }`, while
`textShadow` uses `{ color, blurPixels, offsetXPixels, offsetYPixels }`.
Choose `layoutPreset: 'subtitle' | 'social' | 'socialPop' | 'socialStack' | 'lowerThird'`
for reusable placement and styling defaults; explicit options override the
selected preset.
`socialPop` enables timed word highlighting by default, with a brief pop when
each word becomes active. `socialStack` provides a two-line social caption
layout with three words per line and six words per caption by default. Set
`wordsPerLine` and `wordsPerCaption` to customize line and caption lengths.
For other layouts, word-timed transcripts can set
`wordHighlight: true` and choose `wordHighlightAnimation: 'scale' | 'pop'`;
`wordHighlightColor` customizes the highlight. Explicit options override preset
defaults. Caption presets wrap long text at word boundaries by default; set
`wordWrap: false` to keep a single line. Wrapped words preserve the layout's
horizontal alignment and vertical placement. Use `listCaptionLayoutPresets()`
or `resolveCaptionLayoutPreset(name)` to inspect available layouts. Cue-level
transcripts do not contain enough timing detail for word animations.

GIF cannot carry audio, so timeline rendering rejects GIF requests when audio
clips are present. PNG image sequences export full-resolution RGBA frames to a
new directory and cannot carry audio or audio mastering. Optional CRF and
video-bitrate overrides are available for MP4, MOV, and WebM exports; the
default is still controlled by HyperFrames quality.

Media probes retain the container and separate audio/video stream start times
and time bases. Timeline source times use the media presentation timeline;
frame rounding helpers are available in the JavaScript API. If a linked video
and audio stream has a meaningful start/duration offset, rendering creates and
cleans a temporary timestamp-aligned audio proxy without changing the source.
Standalone audio with a non-zero stream start is also normalized to timeline
zero through a temporary proxy. Variable-frame-rate sources remain seconds-based. A synthetic 30/15 fps source
has been verified rendering at 30 fps on Windows; cross-platform VFR behavior
still needs validation.

## Editing workflow

```sh
# Inspect media and create a project
node src/cli.mjs probe path/to/source.mp4
node src/cli.mjs project create my-video 1080x1920 30 15

# Create or import a transcript
node src/cli.mjs transcribe video-projects/my-video path/to/source.mp4
node src/cli.mjs import-transcript video-projects/my-video path/to/source.mp4 path/to/captions.srt
node src/cli.mjs transcript export video-projects/my-video/transcripts/transcript.json vtt output/captions.vtt

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

### Assemble an edited video in one render

The generic timeline workflow can copy and fingerprint a source, use an
imported or generated transcript, apply a reviewed EDL, retime the transcript,
generate captions, and render the final composition:

```sh
node src/cli.mjs project create my-edit --preset landscape
node src/cli.mjs asset register video-projects/my-edit path/to/source.mp4 camera
node src/cli.mjs transcribe video-projects/my-edit video-projects/my-edit/assets/camera.mp4

# Check copied media and restore a moved or damaged asset under its existing ID.
node src/cli.mjs asset verify video-projects/my-edit
node src/cli.mjs asset relink video-projects/my-edit camera path/to/replacement.mp4
node src/cli.mjs asset preview video-projects/my-edit camera

# Create a reusable draft proxy; request proxy use in timeline render options.
node src/cli.mjs asset proxy create video-projects/my-edit camera 960 28
# Normalize a VFR source proxy to the 30 fps project timeline.
node src/cli.mjs asset proxy create video-projects/my-edit camera 960 28 30
node src/cli.mjs timeline render video-projects/my-edit timeline.json renders/review.mp4 draft render-options.json

# Generate a proposal, review it, then save approved decisions as approved.json.
node src/cli.mjs detect-silence video-projects/my-edit/assets/camera.mp4 video-projects/my-edit/edits/silence-proposal.json
node src/cli.mjs edit video-projects/my-edit camera video-projects/my-edit/transcripts/transcript.json path/to/approved.json
```

Consumers can inject a transcription provider without coupling the Engine to
one cloud vendor or credential store. The provider returns word/cue objects;
the Engine validates and normalizes them against the probed source duration:

```js
await transcribeWithProvider(projectPath, mediaPath, {
  id: 'my-provider',
  async transcribe({ mediaPath, durationSeconds, options }) {
    return providerClient.transcribe(mediaPath, { ...options, durationSeconds });
  },
}, { granularity: 'word', providerOptions: { language: 'en' } });
```

Provider credentials stay inside the consumer's provider client and are not
written to project metadata or the normalized transcript.

The JavaScript API exports `probeMediaAsync(path, { signal })` for cancellable
FFprobe inspection when a consumer needs media metadata without registering the
asset first. The CLI `probe` command uses the same asynchronous path and Ctrl+C
stops its active FFprobe process.

`asset register` probes and copies sources asynchronously. Ctrl+C cancels the
probe or staged copy and cleans the incomplete registration; source files and
existing project assets are left untouched. When `timeline.json` exists, the
new asset's probed metadata is added to its asset catalog without adding a clip;
the editing agent can then place it on a track. JavaScript consumers can use
`await registerMediaAssetAsync(projectPath, sourcePath, { id, signal })`.
Both synchronous and asynchronous registration now probe and fingerprint the
staged copy, so the recorded metadata describes the bytes committed to the
project.

`asset verify` checks registered source and proxy SHA-256 identities against
the manifest and reports missing or modified files. `asset relink` replaces
the media for an existing asset ID, refreshes its probe metadata and
fingerprint, and keeps
the project-relative path stable so existing timeline references continue to
work. If `timeline.json` exists, its asset metadata and source fingerprint are
refreshed as well; the timeline is revalidated before the replacement is saved.
Stale proxies are removed when the source fingerprint changes. Relinking only
accepts the original media type and extension, and preserves the replacement
source file. The CLI stages and probes the replacement asynchronously; Ctrl+C
cancels before commit or restores the prior asset, manifest, and timeline if
the commit fails. JavaScript consumers can use
`await relinkProjectAssetAsync(projectPath, assetId, sourcePath, { signal })`.
Asset registration and relinking update timeline metadata. When a persistent
timeline history sidecar exists, the Engine resets its snapshots automatically
and preserves the configured history limit because asset metadata changes form
a new undo baseline.

Use `asset list` to inspect all registered media, including assets that are not
yet referenced by a timeline. Video/audio records include container aliases
and metadata for every video and audio stream. The command returns versioned
manifest metadata as JSON without touching media files:

```sh
node src/cli.mjs asset list video-projects/my-edit
```

The JavaScript API exposes the same operation as
`listProjectAssets(projectPath)`.

Use `asset unregister` to remove unused media from the project manifest and
timeline catalog. It refuses to unregister an asset referenced by any clip.
The source and proxy files stay on disk, so this operation does not discard
media; delete those files separately only when you have confirmed they are no
longer needed. The API returns the removed asset metadata and confirms that the
files were preserved:

```sh
node src/cli.mjs asset unregister video-projects/my-edit unused-intro
```

The JavaScript API exposes the same operation as
`unregisterProjectAsset(projectPath, assetId)`.

`asset proxy create` generates an H.264, video-only proxy for a registered
video asset. The optional arguments set maximum dimension, CRF, and output
frame rate (defaults: 960 and 28, with no frame-rate conversion); valid ranges
are 160–3840 pixels, CRF 18–40, and frame rate 1–240 fps. A specified frame
rate normalizes source timestamps to a CFR proxy, which can help browser
previews of VFR media. Match the proxy frame rate to the project and enable
proxy rendering. The Engine records the proxy fingerprint and media metadata
in the asset manifest and reuses a matching current proxy. To use proxies for
draft review, set
`{ "useProxies": true }` in the timeline render options JSON. This switches
video clips to the smallest current proxy and leaves audio clips on registered
source media. `asset verify` checks proxy files too; a modified proxy is
regenerated when the same proxy settings are requested again. Regular final
renders continue using the original assets unless proxy use is explicitly
requested. The CLI uses cancellable FFmpeg processing; Ctrl+C stops proxy
generation and removes its staged output. JavaScript consumers can call
`await createAssetProxyAsync(projectPath, assetId, { signal, ...options })`.

`asset preview` creates cached thumbnails and/or an audio waveform for a
registered asset. It returns source-relative thumbnail timestamps and paths,
plus min/max waveform samples that preview clients can draw at any zoom level.
Preview files live under `assets/previews/` and are keyed by the source hash and
generation settings; changed source media cannot silently reuse stale previews.
Pass an options JSON file to override `thumbnailIntervalSeconds` (default 2,
0.25–60), `thumbnailMaxDimension` (default 320, 80–1280), or `waveformPoints`
(default 2000, 32–20000). The JavaScript API is
`await generateAssetPreview(projectPath, assetId, { signal, ...options })`;
thumbnail extraction, waveform decoding, and media probing respond to the
signal. The CLI also cancels active preview processes on Ctrl+C.

Media-analysis providers use the same injected approach. Their findings are
time-checked against the probed source and returned as suggestions for an AI or
human editor to review; the Engine does not turn them into automatic cuts:

```js
const { analysis } = await analyzeMediaWithProvider(mediaPath, {
  id: 'scene-detector',
  async analyze({ mediaPath, durationSeconds, media, options }) {
    return detector.inspect(mediaPath, { durationSeconds, media, ...options });
  },
});
```

Each normalized finding has a stable result-local ID, kebab-case type, start
time, optional end time, optional confidence, and optional description.
Providers may attach a validated `remove-range` suggestion with source bounds
and a reason. Convert explicit suggestions into a review-required EDL draft,
then approve it only after review:

```sh
node src/cli.mjs analysis-to-edl edits/analysis.json edits/candidate-edl.json
node src/cli.mjs approve-edl edits/candidate-edl.json edits/approved-edl.json
```

Candidate EDLs carry `reviewStatus: "needs-review"`; rendering, timeline
construction, and transcript retiming reject them until the explicit approval
command writes a separate approved file. Confidence filtering is optional via
an options JSON file containing `minConfidence` from 0 to 1.

For CLI workflows, pass a trusted JavaScript module that exports a provider as
its default export (or as `mediaAnalysisProvider` / `provider`). The module
receives normalized media metadata and optional provider settings; suggestions
are written to a new JSON file and existing output is never overwritten:

```sh
node src/cli.mjs analyze path/to/source.mp4 path/to/provider.mjs edits/analysis.json provider-options.json
```

Keep provider credentials in the provider's own runtime configuration. The
Engine validates the results and does not store provider credentials.

The EDL is a JSON object with `schemaVersion`, `sourceDurationSeconds`, and
`cuts` entries containing source-time `sourceStart`, `sourceEnd`, and `reason`.
The `edit` command refuses to overwrite existing timeline, approved EDL,
retimed transcript, or render artifacts. It stores the source SHA-256 and
artifact paths in timeline lineage. To edit transcript words before rendering,
apply corrections with `transcript correct` and provide the corrected file to
`edit`. You can also build and render a generic timeline directly with the
JavaScript API (`createProjectTimeline`, `timelineFromEdl`, `editTimeline`,
`editTimelineBatch`, `editTimelineFile`, `undoTimelineFile`,
`redoTimelineFile`, `detachAudioFromTimelineClip`, `createTimelineHistory`,
`createCaptionTrack`, and `renderTimeline`).

Use `timeline inspect` to give an editing agent a compact, read-only view of the
project format, assets, ordered tracks, clip source and timeline ranges,
transitions, and audio settings before it proposes an edit:

```sh
node src/cli.mjs timeline inspect timeline.json
```

The JavaScript API exports the same view through
`inspectTimeline(timeline)`. It validates the timeline first and does not write
or modify project files. Computed clip end times in the summary are rounded to
six decimal places to avoid floating-point display noise.

Generic edit operations can add/remove/reorder tracks and add/remove/duplicate clips, detach clip audio,
move clips within and between compatible tracks, trim/slip/split clips,
insert a synchronized gap or ripple-delete a time range across every track,
apply crossfades or clip-edge transitions, and preserve timeline validation at
each step. Gap insertion trims clips at the insertion point and shifts their
remaining segments and later clips while keeping source ranges, keyframes,
speed ramps, captions, and track synchronization aligned. Ripple deletion
trims or splits clips that straddle the cut, retimes later clips, and shortens
the project. Adding a clip or inserting a gap can extend project duration;
ordinary removal leaves it unchanged so existing downstream timing is preserved.
Cross-track moves preserve the clip id and all clip metadata, and require the
source and destination tracks to have the same kind. To move a video clip to a
different video layer, use `move-track` in an operation file:

```json
{
  "type": "move-track",
  "trackId": "video-main",
  "clipId": "interview-shot",
  "targetTrackId": "video-broll",
  "timelineStart": 8
}
```

Use `set-track-state` to show or hide video/overlay tracks, mute audio tracks,
or adjust audio-track volume through the same reviewable operation workflow.
Partial state updates preserve other settings, and `null` clears an override:

```json
{ "type": "set-track-state", "trackId": "music", "state": { "muted": true, "volume": 0.35 } }
```

To process every clip on a music track with the same chain, set its effects at
track level:

```json
{
  "type": "set-track-audio-effects",
  "trackId": "music",
  "audioEffects": [
    { "type": "lowpass", "frequencyHz": 16000 },
    { "type": "balance", "value": 0.15 }
  ]
}
```

Visual tracks accept `visible`; audio tracks accept `muted`, `volume`, and
project-time `volumeKeyframes` through `set-track-state`. Use the dedicated
`set-track-audio-effects` operation to replace or clear a track effect chain.
Its JavaScript API is
`setTimelineTrackAudioEffects(timeline, trackId, effects)`; pass `null` or an
empty array to clear it. Clip effects run first; then a track with effects is
mixed to one temporary stem and its chain runs across that full timeline.
Clip/track gain, fades, and timing ducking are preserved.

Use `set-overlay` to reviewably change caption text, word timings, layout,
styling, or composition reference after adding the overlay clip. The operation
accepts validated overlay fields only, and `null` clears optional overrides:

```json
{
  "type": "set-overlay",
  "trackId": "captions",
  "clipId": "caption-01",
  "properties": { "text": "A clearer caption", "fontSize": 48, "textAlign": "center" }
}
```

The JavaScript API is `setTimelineOverlay(timeline, trackId, clipId, properties)`.
Use `preview-edit` to inspect caption and layout changes before writing them.

Review the exact result before writing an edit. `preview-edit` prints the
duration change and each added, removed, or updated track and clip as JSON; it
does not write a timeline file:

```sh
node src/cli.mjs timeline preview-edit timeline.json edits/insert-gap.json
```

After reviewing the preview, apply the same operation plan to a new timeline
file. For example, save this as `edits/insert-gap.json`:

```json
{
  "type": "insert-gap",
  "timelineStart": 12.5,
  "durationSeconds": 2
}
```

Then write the result to a new timeline file:

```sh
node src/cli.mjs timeline edit timeline.json edits/insert-gap.json timeline-edited.json
```

The operation file can also be a JSON array. The Engine applies each operation
in order, validates each intermediate timeline, and only writes the final file
if the entire batch succeeds:

```json
[
  { "type": "move", "trackId": "video-main", "clipId": "intro", "timelineStart": 0.5 },
  { "type": "transition", "trackId": "video-main", "clipId": "intro", "edge": "in", "transition": { "schemaVersion": 1, "type": "fade", "durationSeconds": 0.4 } }
]
```

Single-operation files remain supported. Existing output files are never
overwritten. The JavaScript API exposes the same behavior through
`editTimelineBatch(timeline, operations)`. `previewTimelineEdit(timeline,
operations)` returns the same validated change plan without modifying the input.

Replace a clip's media source through a reviewable `replace-asset` operation.
The clip keeps its timeline placement and visual/audio settings; provide new
source bounds when the old range does not fit the replacement. The operation
can also clear an incompatible playback rate or speed ramp with `null`, or
select/clear an audio stream:

```json
{
  "type": "replace-asset",
  "trackId": "video-main",
  "clipId": "b-roll-01",
  "assetId": "b-roll-alternate",
  "sourceIn": 2,
  "sourceOut": 5,
  "playbackRate": null,
  "reverse": false,
  "speedRamp": null
}
```

Use `timeline preview-edit` first to inspect the resulting clip changes. The
same operation is available as `replaceTimelineClipAsset` in the JavaScript API.

Detach the selected video clip's source audio into a synchronized audio clip.
This creates an audio track when the requested one does not exist and keeps
the video clip's source range, timeline placement, and playback rate or speed
ramp. Set `audioStreamIndex` to a zero-based ordinal to select a language or mic
track from a multi-audio source; registered assets expose each stream's codec,
channel layout, timing, language, and title. Edit the new audio clip
independently to create an L-cut or J-cut:

```json
{
  "type": "detach-audio",
  "trackId": "video-main",
  "clipId": "interview-shot",
  "audioTrackId": "interview-audio",
  "audioClipId": "interview-shot-audio",
  "audioStreamIndex": 1
}
```

For interactive workflows, wrap a timeline in bounded in-memory undo/redo
history. Failed edits leave the history untouched, each returned timeline is an
isolated snapshot, and applying a new edit after undo clears the redo branch:

```js
const history = createTimelineHistory(timeline, { limit: 100 });
history.applyBatch([
  { type: 'move', trackId: 'video-main', clipId: 'intro', timelineStart: 1 },
  { type: 'transition', trackId: 'video-main', clipId: 'intro', edge: 'in', transition: { schemaVersion: 1, type: 'fade', durationSeconds: 0.4 } },
]);
const reviewed = history.undo();
const restored = history.redo();
```

The history stores timeline snapshots in memory; save approved project files
separately through the consumer's normal persistence flow. For CLI agents and
other one-shot processes, persistent history operates directly on a timeline
file and keeps a bounded hidden sidecar beside it:

```sh
node src/cli.mjs timeline preview-edit timeline.json edits/move-intro.json
node src/cli.mjs timeline project-edit timeline.json edits/move-intro.json
node src/cli.mjs timeline undo timeline.json
node src/cli.mjs timeline redo timeline.json
node src/cli.mjs timeline history timeline.json
```

The first edit creates `.timeline.json.history.json`; the default history limit
is 20 snapshots. Pass a limit on the first `project-edit` call to choose a
different bound. A failed or interrupted two-file update is recovered from its
atomic history journal on the next command; a lock serializes concurrent CLI
edits and stale locks from exited processes are cleared. If the timeline was edited outside
that history, the CLI reports the mismatch; use
`timeline history timeline.json reset [limit]` to begin a new history from the
current timeline.

For a crossfade between adjacent clips, apply a timeline edit before rendering:

```js
const transitioned = editTimeline(timeline, {
  type: 'crossfade',
  trackId: 'video-main',
  clipId: 'intro',
  incomingClipId: 'main',
  durationSeconds: 0.35,
});
```

Set `allowOverlap: true` on the track and place the incoming clip so it overlaps
the outgoing clip by `durationSeconds`. The operation verifies that timing and
configures opacity fades for video/text or volume fades for audio. Tracks still
control compositing order.

For reusable clip-edge transitions, assign a versioned fade or directional wipe
to a video or overlay clip:

```js
const transitioned = editTimeline(timeline, {
  type: 'transition',
  trackId: 'video-main',
  clipId: 'main',
  edge: 'in',
  transition: { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 0.5 },
});
```

Use `edge: 'out'` for the clip end, or `transition: null` to remove the edge
transition. Wipes accept `left`, `right`, `up`, and `down`; both clip edges can
have transitions when their durations do not overlap. Fade transitions cannot
share opacity animation with that clip, and wipes cannot share a static mask.

Video clips and text/composition overlays can define clip-local visual
keyframes. `x`, `y`, `width`, and `height` are normalized to the canvas;
`opacity` ranges from 0 to 1, and `rotationDegrees` rotates around the element
center. Video clips can animate `objectPositionX` and `objectPositionY` from 0
to 1 to reframe media inside its existing `object-fit` viewport, and `zoom`
from 1× to 4× to scale the media inside a clipped, fixed-size viewport. Use
object-position keyframes to pan the zoom focus without moving the clip's
timeline bounds. Visual filter values include `brightness`, `contrast`, and `saturation`
(0–5), `blurPixels` (0–100), and `hueDegrees` (-360–360). Each keyframe time is
relative to its clip and the first keyframe must be at 0. Values interpolate to
the next keyframe; `ease` is optional and uses an allowlisted GSAP ease. The
last value holds through the clip end. Opacity keyframes cannot be combined
with clip fade fields. Use an `eases` map for per-property easing when one
keyframe changes multiple properties with different curve segments. Trim and
split operations rebase these easing ranges to preserve motion continuity.
An easing slice is represented as `{ type: 'range', name: 'power2.out',
from: 0.5, to: 1 }`, where `from` and `to` select a normalized part of the
allowlisted curve. The validator rejects unrecognized ease names and ranges.

Video and overlay clips also accept validated static masks: `circle` with
`centerX`, `centerY`, and `radius`; `ellipse` with `centerX`, `centerY`,
`radiusX`, and `radiusY`; or `rect` with normalized `x`, `y`, `width`, and
`height`. These are timeline data, not arbitrary CSS values. Animate a mask
with the `maskProgress` keyframe property from 0 to 1; it scales the chosen
shape from its center to its configured bounds. The first keyframe must include
`maskProgress`, and the clip must define a static mask.

Video and overlay clips may set an allowlisted CSS `blendMode` to composite
against lower visual layers. Supported modes are `normal`, `multiply`,
`screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`,
`hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`,
`color`, and `luminosity`. For example, `blendMode: 'screen'` can lighten a
lower layer while preserving its dark areas. Blend modes are isolated to the
project canvas and cannot be applied to audio clips.

```js
const clip = {
  id: 'b-roll',
  assetId: 'camera',
  sourceIn: 0,
  sourceOut: 4,
  timelineStart: 2,
  durationSeconds: 4,
  keyframes: [
    { time: 0, properties: { x: 0.5, y: 0.1, width: 0.4, height: 0.8, opacity: 0 } },
    { time: 1, properties: { x: 0.3, opacity: 1 }, ease: 'power2.out' },
    { time: 4, properties: { x: 0.1, rotationDegrees: -3 } },
  ],
};
```

Animated bounds must stay within the canvas. Keyframes are part of the
schema-version-1 timeline object and use the same JavaScript renderer as other
timeline operations. AI workflows can replace or clear clip keyframes with the
reviewable `set-keyframes` timeline operation. It works in a batch and with
`timeline preview-edit`, so proposed motion can be inspected before saving:

```json
{
  "type": "set-keyframes",
  "trackId": "video",
  "clipId": "b-roll",
  "keyframes": [
    { "time": 0, "properties": { "x": 0.5, "width": 0.4 } },
    { "time": 2, "properties": { "x": 0.2, "width": 0.6 }, "ease": "power2.out" }
  ]
}
```

Set `keyframes` to `null` to remove the animation. The JavaScript API exposes
`setTimelineClipKeyframes(timeline, trackId, clipId, keyframes)`.

Use `set-framing` to reviewably change a video's static fit or normalized
viewport after adding it to the timeline. Partial updates preserve unspecified
fields; set a field to `null` to restore its inherited/default value:

```json
{
  "type": "set-framing",
  "trackId": "video",
  "clipId": "b-roll",
  "framing": { "fit": "cover", "x": 0.1, "width": 0.8 }
}
```

The JavaScript API exposes `setTimelineClipFraming(timeline, trackId, clipId,
framing)`. Timeline validation checks the resulting crop and viewport bounds.

Set a constant `playbackRate` from `0.1` to `5` on video or audio clips. The
source range must equal `durationSeconds * playbackRate`. Rendering creates a
temporary FFmpeg proxy for the selected source range (video is re-encoded;
audio uses pitch-preserving `atempo`) and removes it afterward. Original assets
and the saved timeline remain unchanged.

Set `reverse: true` on a video or audio clip to play its selected source range
backward. It can combine with a constant `playbackRate`, but not with
`speedRamp`. Rendering creates a temporary reversed media proxy and removes it
afterward. FFmpeg's reverse filters buffer the selected clip, so memory use
grows with the clip's duration and resolution. Reverse playback is not represented by the
OpenTimelineIO interchange profile. Detaching a reversed video clip copies the
reverse setting to its audio clip. Trim and split preserve the reverse source
direction. To change it as a reviewable edit, use the
`set-reverse` timeline operation with the CLI or `setTimelineClipReverse` API:

```json
  { "type": "set-reverse", "trackId": "video", "clipId": "shot-1", "reverse": true }
```

The `doctor` command and `getEngineCapabilities()` report whether the FFmpeg
`reverse` and `areverse` filters are available. Rendering checks the filter
needed by each reversed track before it creates temporary media.

For a smooth speed ramp, set source-relative `speedRamp` points instead of a
constant `playbackRate`:

```js
import { speedRampDuration } from 'ai-video-editing-engine';

const speedRamp = [
  { sourceOffset: 0, playbackRate: 1, ease: 'easeInOutCubic' },
  { sourceOffset: 2, playbackRate: 2 },
];
const clip = {
  sourceIn: 0,
  sourceOut: 2,
  durationSeconds: speedRampDuration(speedRamp),
  speedRamp,
};
```

The `ease` field on a point controls the outgoing segment. Supported curves are
`linear`, `easeIn`, `easeOut`, `easeInOut`, `easeInCubic`, `easeOutCubic`, and
`easeInOutCubic`; omitted easing defaults to `linear`. The renderer samples
eased rate curves into bounded linear segments for video timestamp mapping and
audio automation. The clip duration is `integral(ds / playbackRate(s))` over
its source range; the first point starts at offset 0 and the last ends at
`sourceOut - sourceIn`. Use the reviewable `set-speed` edit operation to set a
constant rate, replace a speed ramp, or reset to normal speed. It recalculates
clip duration and scales clip-local animation, fades, transitions, word timing,
and volume automation to preserve their relative timing:

```json
{
  "type": "set-speed",
  "trackId": "video-main",
  "clipId": "shot-1",
  "speed": { "playbackRate": 1.5 }
}
```

Pass `null` for `playbackRate` or `speedRamp` to reset to normal speed. The
same operation is exposed as `setTimelineClipSpeed`.
Rates must stay between 0.1× and 5×. Use the exported `speedRampDuration`
helper to compute the required clip duration. The video proxy maps frame
timestamps through the curve. Audio uses pitch-preserving FFmpeg `rubberband`
commands sampled at up to 50 ms source intervals, then pads or trims to the
clip's exact timeline duration. Audio speed ramps require an FFmpeg build with
the `rubberband` filter; the renderer reports a clear error when it is missing.
The `doctor` command reports whether the filter is available. Trim and split
operations rebase speed curves and visual keyframes at the edit point.

Audio tracks and clips accept `volume` from 0 to 1, and audio clips accept
`fadeInSeconds` and `fadeOutSeconds`.

Use `set-audio-state` to reviewably change an audio clip's static volume, fade
durations, or selected source audio stream. Partial updates preserve unspecified
fields; `null` restores the inherited/default value:

```json
{
  "type": "set-audio-state",
  "trackId": "narration",
  "clipId": "voice-over",
  "state": { "volume": 0.8, "fadeInSeconds": 0.2, "audioStreamIndex": 0 }
}
```

The JavaScript API is
`setTimelineClipAudioState(timeline, trackId, clipId, state)`. Timeline
validation checks the selected stream and clip-bound fade durations.

Video clips can select a zero-based video-stream ordinal with
`videoStreamIndex`. Registered assets expose stream ordinals and their FFmpeg
stream indexes in `videoStreams`. Use `set-video-state` to reviewably change or
clear the selection; rendering creates a temporary clip proxy for the chosen
stream and leaves the source media unchanged:

```json
{
  "type": "set-video-state",
  "trackId": "video-main",
  "clipId": "interview-shot",
  "state": { "videoStreamIndex": 1 }
}
```

The JavaScript API is
`setTimelineClipVideoState(timeline, trackId, clipId, state)`. The same
selection can be supplied when replacing a clip asset with `videoStreamIndex`.

For changing clip gain over time, use `volumeKeyframes`. Times are relative to
the audio clip, begin at 0, and interpolate linearly between points. The last
value holds through the clip end. Trim, split, gap insertion, and ripple delete
preserve the curve. Use `set-volume-keyframes` or the
`setTimelineClipVolumeKeyframes` API to reviewably replace the curve; pass
`null` or an empty array to clear it.

```json
{
  "type": "set-volume-keyframes",
  "trackId": "narration",
  "clipId": "voice-over",
  "volumeKeyframes": [
    { "time": 0, "volume": 1 },
    { "time": 2.5, "volume": 0.35 },
    { "time": 4, "volume": 1 }
  ]
}
```

Audio tracks can also define `volumeKeyframes` to automate the track fader over
project time. These points start at time 0, use linear interpolation, and hold
the last value. Clip and track automation multiply together with static track
  and clip gain. `set-track-state` can replace the track curve; pass `null` to
  clear it. Gap insertion and ripple deletion preserve its timing:

```json
{
  "type": "set-track-state",
  "trackId": "music",
  "state": {
    "volumeKeyframes": [
      { "time": 0, "volume": 0.7 },
      { "time": 5, "volume": 0.25 },
      { "time": 12, "volume": 0.7 }
    ]
  }
}
```

Audio clips can also define an ordered `audioEffects` array. The supported
effects are `equalizer` (`frequencyHz`, `gainDB`, optional `q`), `highpass` or
`lowpass` (`frequencyHz`, optional `order` 1–2), `compressor` (`thresholdDB`,
`ratio`, optional attack/release and makeup gain), and `denoise`
(`reductionDB`, 0.01–30). `balance` takes a `value` from `-1` (left) to `1`
(right), with `0` centered. Effects are applied to a temporary clip proxy,
leaving the registered source unchanged. Denoise requires the `afftdn` filter;
stereo balance requires `stereotools`. `doctor` and `capabilities` report these
and other audio filter availability. Render preflight checks all filters
required by selected clip/track effects, sidechain, and mastering settings
before creating temporary media.
Audio tracks may define the same `audioEffects` array; the Engine mixes the
track's clips to a temporary stem, then applies the track chain across that
complete stem. Use `set-track-audio-effects` to replace or clear the track
chain without editing the timeline file by hand.
Use the reviewable `set-audio-effects` operation or the
`setTimelineClipAudioEffects` API to apply or replace this ordered list. Pass
`null` or an empty array to clear it.

```json
{
  "audioEffects": [
    { "type": "highpass", "frequencyHz": 80 },
    { "type": "denoise", "reductionDB": 12 },
    { "type": "compressor", "thresholdDB": -20, "ratio": 3 },
    { "type": "balance", "value": -0.2 }
  ]
}
```

Keep the final `audioMastering` stage for whole-mix processing such as loudness,
final equalization, limiting, and output channel layout.

To duck a music track while narration clips are active, add this to the timeline:

```js
timeline.audioMix = {
  // Clip-timing ducking remains available without signal analysis.
  ducking: [{
    sourceTrackId: 'narration',
    targetTrackId: 'music',
    attenuation: 0.22,
    attackSeconds: 0.12,
    releaseSeconds: 0.3,
  }],
  // Or compress the music from the actual narration signal.
  sidechain: [{
    sourceTrackId: 'narration',
    targetTrackId: 'music',
    thresholdDb: -24,
    ratio: 4,
    attackSeconds: 0.01,
    releaseSeconds: 0.25,
  }],
};
```

`attenuation` is a multiplier on the target's current volume while source clips
are active. This timing-based option compiles with track/clip gain and fades to
one automation envelope. `sidechain` instead listens to the source track's
rendered signal and applies FFmpeg sidechain compression to target clips. Its
defaults are -24 dB threshold, 4:1 ratio, 10 ms attack, and 250 ms release.
Threshold is limited to -60–0 dB, ratio to 1:1–20:1, attack to 0.01–2000 ms,
and release to 0.01–9000 ms. The detector stem uses source track/clip gain and
fades; output track/clip gain and fades remain applied by the timeline renderer.
This is broadband compression, not speech recognition or phoneme-aware audio
mixing. Final settings still need listening review on varied real material.
Use the reviewable `set-audio-mix` edit operation or
`setTimelineAudioMix(timeline, audioMix)` API to replace these rules; pass
`null` to clear them.

Optional final-mix loudness mastering is configured on the timeline:

```js
timeline.audioMastering = {
  integratedLoudnessLUFS: -16,
  truePeakDBTP: -1.5,
  loudnessRangeLU: 11,
  equalizer: [{ frequencyHz: 120, gainDB: 2, q: 1 }],
  limiter: { limitDBFS: -1, attackMs: 5, releaseMs: 80 },
  channelLayout: 'stereo',
};
```

Defaults are -16 LUFS, -1.5 dBTP, and 11 LU. The renderer analyzes the final
mix and uses two-pass FFmpeg `loudnorm` when the measurements are finite;
unmeasurable non-silent audio falls back to single-pass dynamic normalization.
Fully silent audio is re-encoded without loudness filtering because it has no
measurable level to normalize. Before replacing the unmastered render, the
encoded output is checked for duration, dimensions, and audio presence. GIF
output cannot be mastered because GIF has
no audio stream. Accepted ranges are -70 to -5 LUFS, -9 to 0 dBTP, and 1 to
50 LU, respectively.
Equalizer bands accept 20–20000 Hz, ±18 dB, and Q values from 0.1 to 10 (up to
10 bands). The optional limiter accepts a -20 to 0 dBFS ceiling, 0.1–80 ms
attack, and 10–1000 ms release. Equalization is applied before loudness analysis
and normalization; the limiter runs at the end of the final mix chain. These
controls need listening review against varied real material before mix presets
can be recommended.
`channelLayout` can request a mono or stereo final mix; the encoded channel count
is checked before the mastered render replaces its input. Use the reviewable
`set-audio-mastering` edit operation or
`setTimelineAudioMastering(timeline, settings)` API to replace settings; pass
`null` to clear mastering.

Silence and repeated-word detection produce proposals only. Review and save the
approved cuts in the versioned EDL format before applying them. Source media,
transcripts, EDLs, and render outputs are kept separate; commands refuse to
overwrite existing outputs.

The CLI and JavaScript package exports are the engine interface. Editing agents,
plugins, and creator-facing workflows can be built as separate consumers. See
[`docs/architecture.md`](docs/architecture.md) for contracts and runtime
requirements, and [`docs/handoff.md`](docs/handoff.md) for the full project
context, validation state, and consolidated remaining-work checklist.

## OpenTimelineIO interchange

The optional OTIO bridge imports and exports standard external-media clips and
gaps. Install the pinned Python adapter, then use a project timeline:

```powershell
python -m pip install -r requirements-otio.txt
node src/cli.mjs timeline export-otio video-projects/my-edit timeline.json review.otio
node src/cli.mjs timeline import-otio video-projects/my-edit edit.otio imported-timeline.json
```

The bridge uses the maintained OpenTimelineIO Python library; the Node.js API
and other Engine features work without it. OTIO files reference media by path
and do not embed media. The profile supports video/audio tracks, nested track
stacks flattened into ordered Engine tracks, cuts, gaps, standard
`SMPTE_Dissolve` transitions on import, track enabled state, and project duration
including trailing gaps. Imported dissolves become overlapping clips with
video opacity fades or audio crossfades. Import rejects custom transition
types, other overlaps, retiming, trimmed tracks/stacks, effects, disabled clips,
nested compositions inside tracks, and remote media references. Export converts
explicitly faded two-clip overlaps into standard `SMPTE_Dissolve` transitions.
Unmarked overlaps, chained overlaps, standalone fades, clip-edge transitions,
retiming, track-level volume automation, and track-level audio effects are
rejected instead of silently changing their meaning.
Crossfade offsets and source ranges are derived from the overlapping Engine
clips.
Engine-only clip settings and overlay tracks are retained in OTIO metadata for
Engine round trips, but other editors may ignore or remove that metadata.

## License

AI Video Editing Engine is licensed under the MIT License. See [LICENSE](LICENSE)
for the full text. Third-party dependencies retain their respective licenses.
