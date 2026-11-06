# General-Purpose Video Editing Engine Implementation Plan

This plan guides development of the AI Video Editing Engine as an independent,
local-first editing engine for AI agents and other consumers. Explainer Studio
is one consumer, not the definition of the engine. Avatar animation is one
optional capability. Record implementation progress and verification evidence
in `docs/handoff.md` as work proceeds.

## Delivery constraints

- Provide documented, versioned CLI and JavaScript interfaces that other
  projects can use without depending on Explainer Studio or its assets.
- Preserve source media and existing output; use reviewable edit decisions.
- Keep cloud providers and specialized models optional. Do not put credentials
  or personal recordings in project metadata, logs, or version control.
- Follow Clean Flow: feature branches target `dev` and are squash merged.
  Do not create a `dev` to `main` PR or publish a release without direction.
- Describe platform, codec, and format support only after verification. The
  goal is extensibility, not an unverified promise to support every format.
- Study Herk Edit Kit and Free247VideoEditor as references. Do not copy their
  code, templates, artwork, media, or other assets without a separate license
  and provenance review.

## 1. Audit and architecture — complete

- [x] Inventory verified capabilities in the reference projects, Engine, and
  Studio. The evidence-backed matrix is in `docs/architecture.md`.
- [x] Compare gaps, dependencies, platform claims, license statements, and
  provenance; distinguish published claims from local verification.
- [x] Review the local experimental avatar/audio path: it is not yet a reliable
  generic renderer and stays outside the stable Engine contract until fixed.
- [x] Define the proposed timeline contract, capability discovery, CLI/API
  boundary, validation behavior, and schema evolution policy in architecture.
- [x] Map Studio-owned creative workflow and assets separately from reusable
  Engine media operations.

**Acceptance met:** the architecture doc records local implementation evidence,
reference capability claims, gaps, provenance notes, and a versioned contract
proposal usable by consumers beyond Explainer Studio.

## First implementation after the audit: generic timeline contract

Build the smallest usable, versioned timeline model before adding more
specialized features. It should describe source assets, tracks, clips, source
in/out points, timeline placement, layers, audio, and composition references.
Add validation and a render adapter so the same project can be driven from the
CLI or JavaScript API. Keep transcript edits and EDLs as producers of this
generic timeline rather than separate render paths.

**Progress:** schema v1 validation, CLI validation, EDL-to-timeline conversion,
and a HyperFrames draft render adapter are implemented. The adapter renders
video clips, audio tracks, and timed composition overlays.

**Why first:** the existing engine already has media probing, transcript/EDL
logic, FFmpeg cuts, and HyperFrames rendering, but they are not yet one generic
editing interface. A shared timeline contract lets AI workflows combine those
capabilities and gives later captions, B-roll, audio, motion graphics, and
avatar layers one integration point.

**Acceptance met for the first draft adapter:** a neutral synthetic project was
created and rendered with two video clips, an audio track, and a timed overlay.
ffprobe verified 3 seconds, 320×240, H.264 video, and AAC audio. Manual frame
inspection confirmed the overlay is present. Production-ready positioning,
audio policy, cross-platform and broader format coverage remain open.

## 2. Media and timeline foundation

- [x] Register/copy video, audio, and still image assets; record probed media
  metadata and SHA-256 source identity, and synchronize newly registered asset
  metadata into an existing timeline without creating a clip. The media probe reports streams/codecs.
  `registerMediaAssetAsync` and the CLI add cancellation during staged copy,
  hashing, and probing without exposing a partial asset.
- [x] Expose the registered media catalog through a read-only API and CLI
  command, including assets not yet referenced by the active timeline.
- [x] Unregister unused media assets from the manifest and timeline catalog,
  refusing assets still referenced by clips and preserving source/proxy files.
- [x] Verify registered asset integrity and relink missing or modified media
  under the same asset ID and project-relative path; refresh the manifest and
  preserve the replacement source. The API and CLI also support cancellable,
  staged async relinking with metadata/timeline rollback on commit failure.
- [x] Generate reusable bounded H.264 video proxies, verify their source and
  output fingerprints, opt into proxies for timeline draft renders, and expose
  cancellable async generation through the API and Ctrl+C-aware CLI.
- [x] Model ordered tracks, clips, source ranges, trim, split, move, cuts,
  placement, and layer order with deterministic timing and source provenance.
- [x] Replace clip source assets through a validated reviewable edit operation,
  retaining compatible clip settings and requiring explicit source ranges when
  the replacement does not fit.
- [x] Move clips between compatible tracks while preserving clip metadata,
  applying normal overlap validation, and allowing an optional new timeline
  position.
- [x] Reorder tracks as a reviewable operation while preserving all clip data
  and renumbering the resulting track order deterministically.
- [x] Duplicate a clip with a new ID and explicit timeline position while
  preserving its source, timing, transitions, keyframes, and validated effects.
- [x] Slip media source ranges without moving or resizing timeline clips;
  validate registered asset boundaries and preserve speed ramps and keyframes.
- [x] Probe and retain metadata for every audio stream; detach a selected video's
  chosen audio stream into a synchronized editable clip, preserving source
  timing and constant or ramped playback rate.
- [x] Add synchronized ripple deletion across tracks, preserving source and
  animation timing when clips intersect the removed range.
- [x] Insert synchronized gaps across tracks, splitting clips at the insertion
  point while preserving source ranges, keyframes, speed ramps, and captions.
- [x] Apply ordered AI edit plans atomically through the JavaScript API and CLI;
  represent a successful batch as one undo/redo history action.
- [x] Support explicit track visibility for video/overlay layers and mute for
  audio tracks; remove their excluded ducking/sidechain rules from render state.
  Expose validated visible/muted/volume changes through `set-track-state` for
  batch and dry-run AI edits. An encoded smoke verifies hidden layers render
  black and muted tracks emit no audio stream without mutating the saved edit.
- [x] Validate timelines and edit decisions before rendering; preserve source
  media and refuse to overwrite existing render or edit artifacts.
- [x] Provide a deterministic, read-only timeline overview through the API and
  CLI so editing agents can inspect project settings, assets, tracks, clip
  timing, transitions, and audio properties before proposing edits.
- [x] Expose reviewable project-state edits for timeline duration and project
  source fitting; keep canvas width, height, and frame rate pinned to project
  metadata and reject duration changes that invalidate existing clips.

**Status:** synthetic A/V cut rendering and source immutability are covered by
tests. A generic timeline can also contain multiple video/audio tracks and
image/text/composition overlays. Real multi-clip footage, stream offsets, and
codec coverage still need user-media and cross-platform validation.

## 3. Transcript-driven editing

- [x] Import/normalize transcripts or generate them through the installed
  HyperFrames provider; preserve word or cue granularity and source timing.
- [x] Import JSON, SRT, and WebVTT transcript cues and export normalized
  transcripts to SRT or WebVTT through the CLI and JavaScript API.
- [x] Propose transcript-gap and acoustic-silence cuts, identify adjacent
  repeated words, allow indexed transcript corrections, apply approved cuts,
  and retime words and generated captions consistently.
- [x] Provide explicit project-frame conversion and rounding helpers; enforce
  constant-rate or integrated speed-ramp source-span/duration matches and
  registered-media source boundaries.
- [x] Preserve container and per-stream start times and time bases from media
  probing through timeline construction; normalize materially offset linked
  audio streams and non-zero standalone audio starts during render while
  leaving original assets untouched. A generated MP3 offset test and the
  supplied Voice 015.mp3 render confirm the Windows path.
- [x] Verify a 30/15 fps VFR source renders correctly to a 30 fps output with
  the expected duration, frame count, and source content at sampled times.
- [x] Define and test behavior for overlapping words and partial-word cuts.
- [x] Convert explicit provider removal suggestions into confidence-filtered,
  review-required EDL drafts; require a separate approved file before applying
  suggestions through transcript retiming, timeline creation, or FFmpeg cuts.

**Status:** synthetic audio silence detection and transcript correction tests
pass. User-recorded footage through provider transcription and final caption
review remains outstanding.

Overlapping provider word intervals are accepted and preserved when retiming;
cuts that partially intersect any word, including at either word boundary, are
rejected. Tests cover retained overlap and partial-cut rejection.

## 4. Audio, captions, visuals, and animation

- [x] Add validated clip-local keyframes for normalized placement, size,
  opacity, rotation, object-position reframing, video-only 1×–4× zoom inside a
  clipped fixed viewport, circle/ellipse/rect mask reveals, brightness,
  contrast, saturation, blur, and hue on video and overlay layers. A synthetic Windows
  render confirms keyframe motion by sampling output pixels at two timeline
  positions; a cover-fit render samples red at the start and blue at the end of
  an animated horizontal reframe. A three-shape mask render samples black at
  0.5s and visible near-white at 2.5s for circle, ellipse, and rectangle
  reveals. Trim and split operations slice easing curves
  per property; an encoded 10 fps sample confirms motion
  remains continuous across a split. AI edit plans can set or clear these
  keyframes through the validated, dry-run-capable `set-keyframes` operation,
  and adjust static video fit/viewports through `set-framing`.
- [x] Add allowlisted visual blend modes for video and overlay clips; encoded
  smoke samples confirm `screen` composites a blue still over white footage.
- [x] Support constant video/audio playback rates from 0.1× to 5× and smooth
  source-relative speed ramps; generate temporary FFmpeg proxies and verify
  rendered video and audio timing. A Windows A/V render ramped from 1× to 2×,
  preserving 440 Hz and 880 Hz source sections at the expected output times.
  The reviewable `set-speed` operation now updates rate curves and duration
  while preserving normalized clip-local keyframe, word, and audio automation
  timing; runtime checks remain deferred.
  Eased pitch-preserving audio tempo uses FFmpeg's optional `rubberband` filter,
  sampled at up to 50 ms source intervals and padded/trimmed to the exact clip
  duration. The Windows render smoke measured a cue at 0.492667s versus the
  expected 0.492426s. Cross-platform hosted and real-media validation remain open.
- [x] Support video and audio reverse playback on selected source ranges,
  including combination with a constant playback rate. Rendering builds a
  temporary FFmpeg reverse proxy; reverse plus speed ramps and OTIO interchange are
  rejected explicitly. A reviewable `set-reverse` timeline operation is
  available through the CLI and API. Reverse-filter memory use scales with
  clip duration and resolution. Trim, split, and ripple/gap edits retain the
  reverse source direction. `doctor`, capability discovery, and render preflight
  report/check the required FFmpeg filter; tests and audiovisual review remain
  deferred.
- [x] Support track/clip gain, fades, and configurable clip-timing ducking from
  narration tracks. Gain, fades, and ducking compile to one volume envelope.
  `set-audio-state` reviewably updates clip gain, fades, and source stream choice;
  `set-track-state` supports project-time volume automation on audio tracks.
- [x] Support optional signal-aware sidechain compression between audio
  tracks. A synthetic 3-second music/narration sample confirms compression
  engages during the voice signal and recovers after it; generated detector and
  target proxies are temporary. Settings are validated and documented, and the
  reviewable `set-audio-mix` operation/API replaces or clears mix rules.
- [x] Add ordered per-audio-clip equalizer, high-pass/low-pass, compression,
  stereo balance, and optional FFmpeg `afftdn` noise-reduction processing.
  Clip effects use temporary clip proxies; track effects process a temporary
  mixed track stem. Neither changes source media. Provide reviewable CLI/API
  edits (`set-audio-effects` and `set-track-audio-effects`) and report optional
  filter availability. Render preflight checks all configured effect,
  sidechain, and mastering filters before creating temporary media. Automated
  and listening review are deferred until the
  user resumes validation.
- [x] Add clip-relative volume automation with linear keyframe interpolation;
  preserve the curve during trim, split, ripple-delete, and gap insertion, and
  expose it through reviewable CLI/API operations and timeline inspection.
  Render and listening verification remain deferred.
- [x] Add optional final-mix equalizer, limiter, loudness, true-peak, and
  loudness-range controls; validate the mastered output.
  `set-audio-mastering` provides a reviewable operation/API to replace or clear
  settings. A Windows render measured -16.01 LUFS against a -16 LUFS target and
  confirmed temporary master files are removed.
- [x] Validate mixed audio against source samples and document frame/sample
  alignment. The Windows integration smoke measures a 220 Hz music bed at
  0.2499 peak in the mono source and 0.1763 per channel after center mapping to
  stereo; during the 1 kHz voice it falls to 0.0370, then recovers to 0.1764.
  A 0.35 voice-track gain produces 0.2778 output peak against 0.2800 expected
  from source samples. At 24 fps and 48 kHz, each frame spans 2,000 samples;
  the VFR cue renders at 0.492667s against 0.492426s expected (about 12 samples).
  Listening review with varied real narration/music and long-form material
  remains open.
- [x] Add timed text captions and graphic/composition overlays, B-roll and
  still images; support reusable HyperFrames/GSAP compositions. Adjacent
  video/audio/text clips can use explicit crossfade operations. Versioned
  reusable fade/wipe clip-edge transitions are implemented for video and
  overlays with overlap and effect compatibility validation. Caption font,
  outline, shadow, padding, line-height, and vertical alignment controls are
  implemented. Caption presets wrap text at word boundaries, including
  word-timed active-word highlighting. `socialPop` adds a short scale pop;
  `socialStack` adds deterministic multi-line captions with configurable words
  per line and caption. `set-overlay` provides validated, reviewable caption and
  composition edits after insertion. Consumer-branded templates stay consumer-owned.
- [x] Provide a generic layered composition API and optional speech-avatar
  helpers. `avatar-compose` can generate mouth-state cues through optional
  Rhubarb integration or consume externally generated cue tracks; the Engine
  does not bundle avatar assets or Rhubarb. Sprite states within one layer must
  share PNG canvas dimensions so blink, mouth, and pose changes do not resize
  the layer or shift parent-anchored features.
- [x] Enforce a complete phonetic mouth pack when `avatar-compose` generates
  Rhubarb lip-sync: each speaking mouth layer must provide distinct A-H viseme
  states and an X rest state. Default cue generation enables GHX. Consumers can
  use custom state names through an explicit one-to-one `spriteStateMap`; missing
  or collapsed mouth shapes fail with an actionable error. This requirement
  applies only to phonetic avatar composition; the generic Engine still accepts
  arbitrary external cue tracks.
- [ ] Validate speech-driven avatar animation; evaluate Rhubarb cues on the
  supplied Taglish recording in a rendered avatar with matching user-supplied
  sprites. Rhubarb can now generate mapped mouth cues directly from an
  `avatar-compose` specification, while retaining the standalone `lip-sync`
  command for reusable cue files. A separate Windows Engine render combines
  consumer-provided body, mouth, and blink sprites with Voice 015. Representative
  frames verify mouth placement and full-body framing. A new local 1920x1080,
  30 fps Voice 015 render uses A-H visemes plus X rest and fixed-canvas blink
  assets. The v3 render generated 59 cues, including one G cue; H was present in
  the validated pack but not selected for this recording. A sampled G frame
  confirms the new sprite appears at the existing mouth anchor. The earlier v2
  render remains available for comparison. Human speech-alignment review remains
  outstanding; Rhubarb is an optional external runtime and is not bundled.

**Acceptance:** render both a footage edit with captions and B-roll and an
optional talking-avatar scene; inspect animation and listen to the actual audio.

## 5. Preview, render, and verification

- [x] Provide preview and MP4, WebM, MOV, GIF, and PNG image-sequence export
  operations with configurable dimensions, integer or rational frame rate, and
  draft, standard, or high quality.
- [x] Implement named 9:16, 4:5, 1:1, and 16:9 presets through the JavaScript
  API and CLI using the platform-informed baseline in
  `docs/aspect-ratio-presets.md`; preserve arbitrary dimensions. Crop/fit
  behavior is implemented as a separate explicit policy.
- [x] Check rendered output duration and dimensions, and verify whether the
  output audio stream matches the timeline's audio clips.
- [x] Generate cached, source-fingerprinted image/video thumbnails and streamed
  audio waveform samples for generic preview clients; verify cache integrity.
  Preview generation supports abort signals across thumbnail extraction,
  waveform decoding, and media probing; the CLI cancels those processes on
  Ctrl+C.
- [x] Render one layered integration scene combining VFR footage, proxy-backed
  B-roll, a still image, a nested composition, captions, and narration; sample
  encoded output pixels to verify that the visual layers appear at their timed
  positions. A separate regression render verifies that a video stream whose
  first timestamp is one second still appears at the start of the timeline.
  Human review and real-footage coverage remain open.
- [x] Convert SDR video output to named Rec.709 or Rec.2020 profiles with a
  pixel colorspace transform and verify the encoded stream tags. Add an HDR10
  SDR-to-HDR10 path for MP4/MOV using a 203-nit reference white, 10-bit
  BT.2020/PQ conversion, HEVC Main 10, and mastering/content-light metadata.
  A local synthetic render verifies the encoded stream and HDR metadata; visual
  review with real source footage remains open.
- [ ] Review actual preview and final output for transitions, captions, visual
  defects, and audio. Automated checks do not replace audiovisual review.
  A frame-by-frame contact sheet from the 11.133-second Voice 015/Waren Engine
  render shows stable full-body framing, no obvious clipping, and changing
  mouth/blink states; speech alignment and human audio review remain open.
- [ ] Measure render time and resource use for representative projects; record
  environment, settings, and results in the handoff. An initial Windows
  synthetic-suite baseline and three settings profiles on an 11-second
  1080p/30 fps avatar project are recorded there. Representative real footage,
  isolated render estimates, and cross-platform measurements remain open.
- [x] Import word/cue transcripts from JSON, SRT, and WebVTT; export normalized
  transcripts to SRT or WebVTT through the CLI and JavaScript API.
- [x] Render no-audio video and audio-only timelines in the integration smoke;
  assert whether each output includes an audio stream.
- [x] Validate these media modes and unsupported codec behavior across Windows,
  macOS, and Linux. Local Windows and hosted three-OS smoke cover MP4, VP9/WebM,
  ProRes/MOV, GIF, PNG sequences, and audio-only/video-only output. Explicit
  final encoders are checked against the local FFmpeg encoder registry before
  browser rendering, with unit coverage for encoder-list parsing and missing-
  codec errors.

**Acceptance:** reproducible preview and export with recorded technical and
human review evidence on each claimed supported environment.

## 6. Consumer integration

- [x] Document local installation requirements, doctor capability checks, and
  generic CLI/API examples independent of Studio. Provide a versioned
  `getEngineCapabilities()` API and JSON CLI command for consumer preflight.
  The report exposes the phonetic avatar mouth-shape contract and optional
  Rhubarb availability so consumers can discover the required states at runtime.
- [ ] After the engine prototype passes audiovisual review, connect Explainer
  Studio as a required consumer; provide actionable setup and compatibility
  errors when the engine is unavailable.
- [ ] Migrate reusable Studio media operations and remove duplicate rendering
  only after end-to-end verification of the replacement.

**Acceptance:** one generic workflow and one Studio explainer both render
through the documented engine interface; Studio retains its review gates.

## 7. Delivery and ongoing maintenance

- [x] Expose a private-installable `ai-video-engine` CLI binary. Public package
  publication and the distribution policy remain undecided.
- [x] Add a Linux/macOS/Windows GitHub Actions matrix for Node.js 22, FFmpeg-backed
  tests, and production dependency auditing. Hosted run 42168696652 passed all
  jobs on Linux, Windows, and macOS.
- [x] Add a reproducible HyperFrames render smoke for video ingest, narration,
  captions, export, and output metadata; configure it for every CI operating
  system. Hosted run 42168696652 passed on all three operating systems.
- [x] Measure synthetic A/V sync cues near the start and end of a 12-second
  render. The Windows run measured 0.000021s offset at both cues (effectively
  zero drift); real long-form and variable-frame-rate source validation remains open.
- [x] Add tests for schemas, edits, asset integrity, acoustic silence, and
  transcript corrections; document supported workflow and known limits.
- [x] Run the available runtime dependency security scan and document
  limitations, supported environments, and dependencies for each capability.
- [x] Prepare labeled feature PRs targeting `dev`; use existing labels only.
  The generic Engine feature is in PR #1 with `enhancement` and `documentation`
  labels; it remains open for review.
- [x] Update the handoff with current status, evidence, blockers, and the next
  concrete task. Avoid claiming completion from test results alone.

At the user's direction, automatic test, render-smoke, and dependency-audit
workflows are temporarily disabled during implementation. The workflow remains
available through manual dispatch; restore automatic checks for the manual
debugging phase. Do not treat earlier green runs as verification of current
unverified changes.

## Full-editor capability backlog

The Engine is a headless editing runtime and API for AI workflows; it does not
aim to reproduce a desktop NLE interface. Prioritize production editing depth
in this order:

1. **Timeline reliability:** frame-accurate rounding, cross-platform VFR
   behavior, stream offsets, proxy/source mapping, and boundary tests across
   representative codecs and operating systems. Proxies can now explicitly
   normalize to the project frame rate; validate more source timing cases.
2. **Keyframes and effects:** normalized transform, animated object-position
   reframing, circle/ellipse/rect masks with reveal keyframes, visual filters,
   constant playback rates, source-relative eased speed ramps, and versioned
   fade/wipe transitions are implemented. Validate the approximation on
  longer clips and real footage. The current smoke covers a ramped video with
  normal-speed audio; do not treat eased audio speed ramps as verified.
3. **Audio post-production:** clip-timing ducking, signal-aware sidechain, and
  loudness normalization, bounded equalizer bands, and sample-peak limiting are
  implemented. Mono/stereo final channel mapping is implemented. Add measured
   A/V synchronization across real source material. A synthetic VFR render
   exposed a one-frame browser seek delay; project-rate CFR proxying corrects
   the tested cue, while broader camera/media validation remains open.
4. **Media and export controls:** configurable quality, codec, video bitrate,
   capture workers, low-memory mode, and PNG image-sequence export are
  implemented. `renderTimelineAsync` applies a bounded deadline and shared
  cancellation across asynchronous preprocessing, HyperFrames, final encoding,
  probing, and audio mastering. Rec.709 and
  Rec.2020 SDR output profiles perform an
  FFmpeg colorspace transform; HDR10 output converts SDR renders to 10-bit
  BT.2020/PQ with HEVC Main 10 and HDR metadata. Runtime and visual validation
  remain open. Async rendering now supports
  bounded, expiring, content-verified capture checkpoints to retry final-stage
  failures; browser-capture interruption still restarts that stage.
  **Project interchange is implemented:** the
  optional OpenTimelineIO bridge uses the maintained Python library and native
  JSON adapter; the profile imports/exports external-media cuts, gaps, nested
  track stacks (flattened into ordered tracks), track enabled state, and
  timeline duration. Import expands `SMPTE_Dissolve` transitions into video
  opacity fades or audio crossfades; custom transitions, other overlaps,
  retiming, trimmed tracks/stacks, effects, disabled clips, and nested
  compositions inside tracks are explicitly rejected. Export converts
  explicitly faded two-clip overlaps into `SMPTE_Dissolve` transitions and
  rejects unmarked/chained overlaps, standalone fades, clip-edge transitions,
  and retiming. Tests remain deferred until the user resumes manual validation.
5. **Workflow quality:** visual preview/review artifacts, richer caption
   layout templates, undoable and dry-run reviewable edit operations, injected transcription and
   media-analysis provider APIs, and CLI-loaded analysis provider modules are
   implemented. Persistent CLI timeline history now carries undo/redo snapshots
   across process invocations, serializes concurrent updates, and recovers an
   interrupted atomic timeline write;
   behavior tests remain deferred per the user's direction. `project create`
   now seeds a validated blank timeline from the project metadata and media
   catalog, and `timeline create` initializes one for existing projects.
6. **Real-world acceptance:** render varied footage and audio on Windows,
   macOS, and Linux, inspect output frames, listen to audio, and measure memory
   and render time before claiming broad editor-grade support.

These features should remain generic and composable; Studio-specific scripts,
avatar art, and narration policy belong to Explainer Studio.

**Progress:** bounded in-memory timeline history is implemented through the
JavaScript API. It supports undo/redo, reset, safe cloned snapshots, invalid
operation isolation, and clearing redo history when a new edit is applied.
Caption generation also offers reusable subtitle, social, social-pop, and
lower-third layouts with per-option overrides. The `socialStack` layout adds
deterministic two-line captions with configurable words per line and caption;
word-timed highlights remain attached to each word when the caption is split
into lines. Complex consumer-branded templates remain consumer-owned.
The JavaScript API also accepts injected transcription adapters, validates and
normalizes their output against probed source duration, and stores normalized
transcripts without writing provider credentials. Media-analysis adapters and
CLI-loaded provider modules return normalized time-coded findings with
source-bound validation. Explicit provider cut suggestions convert to
review-required EDL drafts; render and retime paths reject drafts until a
separate approved file is written. Providers never apply edits automatically.
Timeline editing supports adding and removing validated tracks and clips; a
new clip extends project duration while removals preserve the existing duration.
Timeline edit plans can now be previewed through the API or CLI before writing:
the dry run reports exact track and clip changes plus before/after project
duration, and leaves the source timeline untouched.
Clips can also move between compatible same-kind tracks without losing their
source range, keyframes, effects, transitions, or other clip metadata.
Track ordering can be changed through the same validated edit-plan interface;
the complete track objects and their clips stay intact.
Clips can be duplicated into an explicit position with all edit metadata
preserved, subject to target track overlap and project-bound validation.
Injected media-analysis findings can propose explicit source-range removals;
the Engine emits a confidence-filtered review-required EDL, and render and
retime paths require an explicitly approved EDL before applying those cuts.

## Current starting point

The current local branch is `feature/generic-video-engine`. It includes the
generic timeline, media catalog and proxy support, edit operations, transcript
and provider workflows, layered video/overlay composition, audio mixing and
mastering, preview assets, export controls, and OpenTimelineIO interchange.
Optional avatar composition and Rhubarb lip-sync workflows are consumer-neutral
Engine capabilities; their generated Voice 015 outputs have not received human
audio/visual approval, and this branch has not been validated after the latest
implementation changes.

The current implementation pass adds cancellable async probing to direct
`renderProjectAsync` output checks, in addition to the timeline async pipeline,
and checks timeline output encoders/color filters before creating temporary
media. No tests or renders were run for these changes, per the user's
implementation-first direction. Do not treat earlier test, render, or CI
results as evidence for the current branch state. The next delivery gate is to
finish the remaining Engine code work, then run the user-directed validation
pass before requesting audiovisual review or starting Explainer Studio
integration. Recheck current branch and remote state before publishing.
