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
6. **Agent-readable state:** expose a deterministic read-only summary of the
   project, media, tracks, and clip timing before an editing agent proposes
   changes.

These targets define this repository's engine scope. Consumer products, plugins,
image editing, asset-generation marketplaces, and large bundled style libraries
belong elsewhere.

New projects include a validated empty timeline initialized from project
dimensions, frame rate, duration, source-fit policy, and registered asset
metadata. Existing projects can create the same timeline through the CLI or
`createProjectTimeline` API. The default track scaffold contains video, audio,
and overlay tracks; consumers can add or remove tracks through normal edit
operations.

## OpenTimelineIO interchange boundary

The optional `src/interchange/otio.mjs` module invokes a small Python bridge
that uses the maintained OpenTimelineIO library and its native `otio_json`
adapter. This keeps OTIO parsing and serialization out of hand-written Node
code and keeps Python/OpenTimelineIO optional for consumers that do not use
interchange. The pinned optional dependency is in `requirements-otio.txt`.

The interchange profile maps external media references, video/audio tracks,
nested track stacks (flattened into ordered Engine tracks), clips, gaps, track
enabled state, and project duration including trailing gaps. Import expands
standard `SMPTE_Dissolve` transitions into overlapping Engine clips with
video opacity fades or audio crossfades. It rejects custom transition types,
other overlaps, speed changes, trimmed tracks/stacks, effects, disabled clips,
nested compositions inside tracks, non-file remote references, and missing
media instead of silently changing their meaning. Export converts explicitly
faded two-clip overlaps to standard `SMPTE_Dissolve` transitions. Unmarked or
chained overlaps, standalone fades, clip-edge transitions, and retiming are
rejected instead of silently changing their meaning. Track-level audio effects
and volume automation are also refused on export because the profile does not
map them to standard OTIO effects. The full Engine timeline is carried in
namespaced OTIO metadata so Engine-specific overlays and settings can survive
an Engine-to-OTIO-to-Engine round trip. Other editors may discard unknown
metadata, so this is not a cross-editor preservation guarantee. OTIO references
media paths and does not package the media files.

## Phase 1 capability audit (2026-11-05)

The table separates what the local checkout implements from what reference
project documentation says it does. Reference claims are not local verification.

| Capability | Engine local checkout | Herk Edit Kit reference | Free247Editor reference |
| --- | --- | --- | --- |
| Media inspection | Implemented with ffprobe | Uses FFmpeg-based workflow | Requires FFmpeg; setup checks tools |
| Transcript timing | Normalize/import and HyperFrames transcription wrapper | Word timing and transcript-driven workflow | Groq or faster-whisper routes advertised |
| Edit decisions | Silence-gap proposals, repeated-word candidates, validated EDL and retiming | Silence/mistake cutting and reviewed EDL workflow | Describes dead air, breaths, false starts, and retake cuts |
| Cut/render pipeline | FFmpeg cut helper plus EDL-to-timeline MP4 orchestration | Integrated agent workflow | README says it installs a pinned Herk Edit Kit under `kit/` |
| Composition/motion | HyperFrames project render wrapper; GSAP starter | HyperFrames, GSAP, reusable motion cards/templates | Attributes motion graphics to HyperFrames + GSAP through Herk |
| Captions/B-roll/audio design | EDL-to-MP4, timed text, still/video layers, gain/fades/clip-timing ducking; no automatic B-roll selection | Workflow includes captions, B-roll, music/SFX, review | README advertises word-level captions, B-roll, SFX/music, camera reframing |
| Consumer interface | Local Node ESM API and private CLI binary | Agent skills orchestrate kit tools | Agent skill orchestrates bundled/pinned Herk kit |
| Avatar speech | Optional Rhubarb adapter produces validated timed mouth-shape cues; phonetic avatar composition requires distinct A-H mouth states and X rest; sprite preflight checks PNG headers, shared canvas dimensions, and byte-distinct images; CLI/API support consumer-owned sprite validation; default cue generation enables GHX; requires external CLI and consumer-supplied sprites; audiovisual quality review remains pending | Talking Explainer is a separate reference, not a Herk core requirement | Not a core editor capability |
| Platform evidence | Windows checkout only; do not infer universal support | README documents Windows/macOS/Linux requirements; not independently tested here | README reports Windows 11 test; macOS/Linux are stated but untested |

**Audit conclusion:** The Engine now provides a shared timeline schema,
validation, CLI/API, media registration, EDL conversion, transcript-to-caption
assembly, a HyperFrames renderer, and basic audio mix automation. Visual
effects breadth, speech-aligned avatar animation, cross-platform coverage, and
full audiovisual quality review remain open. Skills, personal style/rules,
explainer storyboards, and owned avatar art remain consumer concerns. Studio
can call reusable Engine operations while retaining its chat approvals and
creative direction.

**License/provenance note:** the Herk repository identifies its project
license as MIT and lists separate third-party notices; each included
dependency/asset retains its own terms. Free247Editor identifies itself as MIT
and describes downloading a pinned Herk kit rather than copying it into its
own engine source. This Engine will implement its own contracts and code; do
not copy either project's skills, assets, templates, or code during the audit
or implementation without a provenance and license review.

## Proposed generic project and timeline contract

The first contract is intentionally small and renderer-neutral. JSON examples
will be checked into docs only after the validator and CLI/API land.

- `schemaVersion`: integer for explicit compatibility and migrations.
- `project`: stable id, width, height, frame rate, and duration in seconds.
- `assets`: stable ids and project-relative media paths; probe metadata is
  derived and records streams, duration, dimensions, average and nominal frame
  rates, per-stream timing, and codecs. When the container duration is absent,
  probing falls back to the longest valid stream duration, deriving seconds
  from `duration_ts × time_base` when needed; media with no usable duration
  remains invalid. Asset verification compares SHA-256
  identities, while relinking replaces media under the same stable id/path and
  refreshes its probe record without modifying the replacement source.
  Optional video-only H.264 proxies retain their own dimensions, stream timing,
  settings, and source/output SHA-256 identities. Draft renders can explicitly
  select those variants; audio and default final renders continue using source
  assets.
- `tracks`: ordered tracks with stable ids and kinds (`video`, `audio`,
  `overlay`), plus explicit z-order and optional mute/visibility settings.
- `clips`: stable id, asset reference, source in/out, timeline start, and
  optional placement/fit, constant `playbackRate`, source-relative `speedRamp`,
  or reverse playback on video and audio clips,
  volume, and composition reference. A speed ramp has linear or named eased
  `playbackRate` interpolation between `{ sourceOffset, playbackRate, ease? }`
  points covering the full clip source span; the optional ease controls the
  outgoing segment. Its timeline duration is the integral of source time
  divided by playback rate. Eased curves are sampled into bounded linear
  segments for rendering. Constant-rate clips use source span = clip duration
  × playback rate. All times are seconds; renderers quantize to project frames
  in one documented step.
- `keyframes`: optional clip-local visual states on video and overlay clips.
  Normalized x/y/width/height, opacity, rotation, brightness, contrast,
  object-position, 1×–4× video zoom, saturation, blur, and hue interpolate
  through GSAP. Zoom scales media inside its fixed, clipped viewport;
  allowlisted easing controls each segment. Per-property easing ranges preserve
  the curve when a clip is trimmed or split inside a tween. The first key must
  be at time zero, geometry must remain within the canvas, and opacity keyframes
  cannot overlap the separate clip-fade controls.
- `mask`: optional clip-path mask on video and overlay clips. Version 1 supports
  normalized `circle`, `ellipse`, and `rect` shapes; `maskProgress` keyframes
  animate the configured shape between closed and full bounds. Shape fields are
  validated and compiled to CSS; raw CSS strings are not accepted.
- `blendMode`: optional allowlisted CSS compositing mode on video and overlay
  clips. Modes blend the clip against lower visual layers within an isolated
  project canvas; arbitrary CSS and audio-track use are rejected.
- `transitionIn` and `transitionOut`: optional version-1 `fade` or directional
  `wipe` transitions on video and overlay clips. Their durations cannot overlap;
  wipes cannot share a static mask, and fades cannot share opacity animation.
- `audioMix`: optional clip-timing ducking and signal-aware sidechain rules
  between audio tracks. Timing ducking combines with track/clip gain and fades
  in one volume envelope. Signal-aware rules build temporary detector stems
  from source track clips and create temporary compressed target audio clips;
  all generated media is removed after render.
- `audioEffects`: optional ordered per-clip equalizer, high-pass, low-pass,
  compressor, stereo-balance, and noise-reduction effects on audio tracks.
  Audio tracks can also define an ordered track-level chain. Clip effects run
  first; track clips are then mixed to a temporary stem and the track effects
  run across the full stem. Required FFmpeg filters for clip/track effects,
  sidechain, and mastering are included in capability discovery and checked
  before rendering.
- `volumeKeyframes`: optional, clip-relative audio gain automation with linear
  interpolation and a held final value. Time 0 is required; trim, split, and
  synchronized timeline operations rebase and preserve the curve.
- Audio tracks can also define `volumeKeyframes` in project time. The curve is
  multiplied with static track/clip gain and clip automation; gap insertion and
  ripple deletion preserve its shape relative to edited timeline content.
- `audioMastering`: optional final-mix integrated loudness, true-peak ceiling,
  and loudness-range targets. FFmpeg `loudnorm` uses measured two-pass mode
  when possible, dynamic single-pass mode for unmeasurable non-silent input,
  and preserves valid silent tracks without a loudness filter. Optional
  parametric equalizer bands run before analysis/normalization, and an optional
  sample-peak limiter runs at the end of the final mix chain. Consumers can
  request mono or stereo output and the encoded channel count is verified.
- `overlays`: timed composition references with validated duration and layer
  order. Text/caption semantics live in composition data, not in a Studio-only
  field.
- `lineage`: optional transcript/EDL references and source identities so
  transcript edits can compile into the same timeline.

Validation rejects missing assets, paths escaping the project when assets are
project-managed, non-finite or negative times, invalid source ranges, timeline
clips beyond project duration, source ranges beyond known registered media
duration, mismatches between source span and constant-rate or integrated
speed-ramp duration,
unknown track kinds, and duplicate ids. A non-default media playback rate is
rendered through a temporary FFmpeg proxy that is removed after render; video
proxy encoding and pitch-preserving audio `atempo` are explicit costs. Eased
audio speed ramps use FFmpeg's optional `rubberband` filter to preserve pitch;
rendering such a ramp fails with an actionable error when the filter is absent.
Reverse video and audio playback use an FFmpeg temporary proxy for the selected
source range. They can combine with a constant playback rate, but not a speed
ramp; image assets cannot be reversed. FFmpeg's reverse filters buffer the
selected clip, so memory use grows with clip duration and resolution. Trim and
split operations preserve the reverse source direction. Detaching audio from a
reversed video clip copies the reverse setting to the audio clip. OTIO export
rejects reverse playback rather than silently dropping it.
Capability discovery reports the `reverse` and `areverse` filters, and render
preflight checks the specific filter required by a reversed track before the
renderer creates temporary media.
If a linked video's audio stream has a material start or
duration offset, the renderer creates a temporary FFmpeg-normalized audio file
for the composition and removes it afterward; source media stays unchanged. Overlap
is allowed within a track only when explicitly represented; tracks define
compositing order. Existing schemaVersion 1 transcript and EDL contracts stay
supported and can be compiled into the timeline model.

Consumers use the same operations through CLI and JavaScript exports. Timeline
operations include validation, EDL assembly, track/clip add and remove, trim,
slip, split, move, synchronized gap insertion and ripple deletion, crossfade,
registered-asset replacement, reviewable speed changes, versioned fade/wipe transitions, reviewable visual framing and keyframe changes,
track visibility/mute/volume changes, caption generation, and rendering.
Reviewable audio clip gain/fade/stream selection and overlay content/style
changes join this operation surface. `set-audio-mix` and
`set-audio-mastering` expose validated reviewable changes for timeline-level
mix rules and final-mix settings. `set-project-state` can change timeline
duration and project-wide source fitting while keeping width, height, and frame
rate consistent with Engine project metadata.
Consumers can wrap immutable edits in bounded in-memory undo/redo history that returns
isolated snapshots and drops redo entries after a new branch of edits. CLI agents
can also use persistent timeline-file history across process invocations. It
stores bounded snapshots in an atomic sidecar journal, recovers an interrupted
timeline write, and refuses to overwrite a timeline modified outside the
history session until the user resets that session. A lock serializes history
updates and stale locks from exited processes are cleared. Crossfades configure GSAP opacity or
audio-volume fades on a validated, caller-positioned clip overlap. Video and
overlay clips can animate normalized placement, size, opacity, rotation, and
CSS visual filters with clip-local keyframes. Rendering compiles video clips, audio
tracks, text overlays, and timed compositions into a HyperFrames project before
draft/standard/high rendering. MP4, WebM, MOV, and GIF file exports are accepted
by extension; PNG sequences are requested explicitly. GIF and PNG sequences are
rejected for timelines with audio. PNG sequences are written as validated
full-resolution RGBA frame directories.

Injected transcription and media-analysis providers are generic JavaScript
adapters. Transcript output is normalized to the source duration. Media
findings are returned as time-validated suggestions for review and are not
automatically converted into timeline edits. Provider credentials remain in
consumer code and are not stored in project metadata.
Rational project frame rates are passed to
the renderer and checked in the output. MP4, MOV, and WebM renders can override
the quality preset with validated codec, CRF, or target video bitrate options.
Explicit codec overrides are applied by a final FFmpeg encode and the output
codec is checked before publishing the file. Render options can bound capture
workers from 1 to 64, select HyperFrames low-memory mode, and set a bounded
render timeout that also applies to the explicit-codec FFmpeg stage. The async
render APIs accept an `AbortSignal`; the CLI maps Ctrl+C to process-tree
cancellation. `renderTimelineAsync` applies one deadline to FFmpeg/ffprobe
preprocessing, HyperFrames, final encoding, output probing, and audio mastering.
Timeout and cancellation remove Engine and HyperFrames temporary outputs and
roll back timeline metadata. The async timeline renderer uses cancellable
FFmpeg/ffprobe child processes for media preparation and mastering, so timeout
and external abort signals terminate the active process tree.
Color profiles can request Rec.709, Rec.2020 SDR, or HDR10. HDR10 export is an
SDR-to-HDR conversion for MP4/MOV: it maps the Rec.709 render to 10-bit
BT.2020/PQ at a 203-nit reference white and requires FFmpeg `zscale` plus
`libx265` Main 10. This changes the transfer function and encoding precision;
it cannot recreate highlight information absent from the SDR render.
The async renderer can preserve a completed HyperFrames capture for retrying
the final stage. Checkpoints are content-fingerprinted, SHA-256 verified,
bounded by per-capture size and expiration, and removed after success. An
interrupted browser capture starts over; this is stage-level recovery, not
frame-level continuation. PNG sequences and synchronous rendering are excluded.
The core validator does not require FFmpeg or a
browser. Schema changes require a version increment or an explicit
backward-compatible migration.

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

The engine creates projects at caller-selected dimensions, registers and
fingerprints media, imports or generates transcripts, proposes editable cuts,
applies approved EDLs, retimes transcripts, generates captions, and
lints/previews/renders HyperFrames compositions. The generated starter
composition is intentionally small; editing intelligence and user approval
stay outside the renderer.

Named social-video canvas presets are 9:16, 4:5, 1:1, and 16:9, with arbitrary
dimensions remaining supported. The registry is exposed through the JavaScript
API and CLI; project metadata records the selected preset id and resolved canvas
dimensions. Their platform mapping and default pixel dimensions are documented
in [`aspect-ratio-presets.md`](aspect-ratio-presets.md). A preset selects canvas
dimensions only; source fit/crop behavior stays an explicit rendering choice.
Source-fit modes are `contain`, `cover` (center crop), and `fill` (stretch),
with `contain` as the non-cropping default. Project policy may be overridden by
a video clip's `fit` value.

## Version 1 data contracts

Transcript JSON uses `schemaVersion: 1`, `durationSeconds`, and `words` with
`text`, `start`, and `end` fields. Times are seconds on the original media
timeline. Words must be ordered by start time and stay within the media duration.
Provider word intervals may overlap; the engine preserves those source timings
and their overlap when retiming. It does not infer which provider timestamp is
more accurate or force neighboring words apart.
Registered assets retain FFprobe container and per-stream start times and time
bases for diagnostics and downstream timing decisions. Use `secondsToFrame`,
`frameToSeconds`, or `snapTimeToFrame` for explicit output-frame rounding.
Variable-frame-rate source timestamps remain seconds-based and must not be
snapped to the project frame rate; broader VFR seek/render behavior remains a
validation item. When linked video/audio start times differ, or a standalone
audio stream starts after zero, the renderer creates and removes a temporary
timestamp-aligned audio proxy. Original assets remain untouched.

An approved EDL uses `schemaVersion: 1`, the same `sourceDurationSeconds`, and a
`cuts` array. Each cut has `sourceStart`, `sourceEnd`, and a non-empty `reason`.
Cuts must be ordered, non-overlapping, positive-duration intervals within the
source. A cut may fully contain a transcript word, removing it. It may not split
a word; cuts that touch only the beginning or end of a word are also rejected.
With overlapping word intervals, a cut that fully contains one word but only
partly intersects another is rejected because it would clip the latter word.
These checks prevent the retimed transcript from claiming that clipped speech
is intact.

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
runtimes. Consumers can query the versioned `getEngineCapabilities()` API or
`ai-video-engine capabilities` CLI command to discover required tools, common
FFmpeg demuxers and decoders for common input media, encoders, output formats,
detected codec/per-format color-profile support, predefined canvas presets,
and optional render filters without relying on doctor output parsing. Input
`available` reports whether FFmpeg and ffprobe are installed; `inventoryChecked`
reports whether the decoder and demuxer lists could be read. Container and
decoder fields are independent checks; having both does not prove that every
media stream combination will decode. Format availability reflects the relevant local FFmpeg,
ffprobe, HyperFrames, encoder, and filter inventory. The browser runtime is
reported as unchecked and must be verified with `npm run doctor`. The report
marks a format available when its render runtime and at least one compatible
encoder are present; `defaultCodecAvailable` indicates whether the default
encoder is installed. It does not guarantee that every input codec or
media-specific render operation is supported.
For operation-specific input checks, the JavaScript API exposes
`listFfmpegDecoders()`, `listFfmpegDemuxers()`, their boolean `has` helpers, and
their throwing `assert` helpers. `inspectMediaCompatibility(path)` probes a
source and checks its container plus every reported audio/video stream against
the local FFmpeg inventory before ingest; it does not decode the full file.

Pinned package versions are an initial baseline from the installed Herk Edit Kit
setup, not a promise of compatibility with future releases. Recheck versions and
licenses before upgrades or distributing a build.
