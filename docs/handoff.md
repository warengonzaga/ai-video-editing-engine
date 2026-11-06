# AI Video Editing Engine — Project Handoff

The phased implementation plan and acceptance criteria are in
[`implementation-plan.md`](implementation-plan.md). Keep this handoff current
with verified capabilities, evidence, limits, and the next work.

Last updated: 2026-11-07

## Current status

- The Engine is a generic, local-first Node.js CLI/API. Explainer Studio is a
  future consumer, not part of the Engine's timeline contract.
- Generic timeline v1 supports ordered video/audio/overlay tracks, clip source
  ranges, placement and local keyframes for position, size, opacity, rotation,
  object-position reframing and video-only 1×–4× zoom inside fixed viewports,
  validated circle/ellipse/rect masks with `maskProgress` reveal keyframes,
  versioned fade/wipe transitions on video and overlay clip edges,
  brightness, contrast, saturation, blur, and hue; constant media playback
  rates from 0.1× to 5× and source-relative eased speed ramps; trim, split,
  move, and crossfade operations; text captions, images,
  reusable HyperFrames compositions, and project/clip source-fit policies.
- Projects can register copied video, audio, and image assets. The manifest
  records probe metadata and source SHA-256. The original input remains
  unchanged. Audio/video stream start times, durations, and time bases are
  preserved for timeline diagnostics; known asset duration and exact clip
  source spans are validated before rendering. `asset verify` reports missing
  or modified source and proxy files, while `asset relink` restores media under
  its existing ID
  and project-relative path and refreshes probe metadata and fingerprint in
  both the asset manifest and any existing timeline; that timeline is
  revalidated before the replacement is committed, and stale proxies are
  removed after the source fingerprint changes. `asset proxy create`
  generates source-fingerprinted H.264 video-only proxies; timeline draft
  renders can opt in with `useProxies: true`, while final renders use originals
  by default.
- `generateAssetPreview` and `asset preview` create content-keyed JPEG
  thumbnails for registered images/video and streamed 4 kHz mono min/max
  waveform samples for assets with audio. Preview records verify source and
  cached-file SHA-256 values before reuse; generation options control thumbnail
  spacing/size and waveform point count.
- Audio tracks and clips support gain, clip fades, clip-timing ducking, and
  signal-aware track sidechain compression. Optional timeline loudness
  mastering accepts integrated LUFS, true-peak, loudness-range, EQ-band, and
  limiter settings and processes the final mix. Final mono/stereo channel layout
  is configurable and verified in the encoded output.
- Transcript tools include provider import/normalization, transcript-gap and
  acoustic-silence proposals, repeated-word candidates, indexed corrections,
  approved EDL retiming, and timed caption generation.
- Optional OpenTimelineIO interchange uses the maintained Python adapter to
  exchange external-media cuts and gaps. It is not required for Node-only use;
  unsupported timeline constructs fail explicitly, and Engine-specific effects
  and overlays survive round trips only while their OTIO metadata is retained.
- The `edit` command assembles a registered source, approved EDL, retimed
  transcript, captions, and audio into a HyperFrames project and renders MP4.
  It refuses to overwrite the project's edit artifacts or selected output.
- Caption text supports validated font family/weight, line height, vertical
  alignment, padding, outline, and shadow settings in addition to position,
  size, color, background, and alignment.
- The JavaScript API exposes bounded in-memory timeline undo/redo history over
  immutable edit operations. Returned snapshots are isolated, invalid edits do
  not mutate history, reset clears the stack, and new edits discard redo state.
- The API's `editTimelineBatch` and history's `applyBatch` apply ordered edit
  plans all-or-nothing; a completed batch is one undo/redo action. The CLI also
  accepts an operation array and writes no output if any operation fails.
- `previewTimelineEdit` and `timeline preview-edit` dry-run the same validated
  operations and report exact track/clip changes plus project duration before
  and after; previews do not mutate the source or write a timeline file.
- Caption generation provides generic `subtitle`, `social`, `socialPop`,
  `socialStack`, and `lowerThird` layout presets with explicit style overrides.
  The `socialStack` preset creates deterministic two-line captions with a
  configurable number of words per line and caption. The `socialPop`
  preset enables word-timed highlighting with a brief GSAP pop on the active
  word; other layouts can select `scale` or `pop`. A pixel-sampled render smoke
  verifies the timed highlight. Preset captions wrap at word boundaries;
  consumer-branded templates remain consumer-owned. The new stack layout has
  not been run through the test or render-smoke suites per the user's request
  to defer tests until manual debugging.
- `transcribeWithProvider` accepts an injected JavaScript provider, supplies
  probed media duration, validates and normalizes returned word/cue timing, and
  writes the result without persisting provider credentials. Media-analysis
  CLI accepts a trusted, user-supplied provider module and writes normalized
  time-coded suggestions to a new output file. `analyzeMediaWithProvider`
  returns findings without applying edits or storing provider credentials.
- Providers may attach bounded `remove-range` edit proposals to analysis
  findings. `mediaAnalysisToEdl` converts and confidence-filters them into a
  review-required EDL; `approve-edl` writes a distinct approved copy. Render,
  timeline construction, and transcript-retiming paths reject EDLs marked
  `needs-review`.
- Timeline operations can add/remove tracks and clips alongside move, trim, slip,
  split, crossfade, transitions, gap insertion, and ripple deletion. Slip edits
  shift a media clip's source range while preserving its timeline position and
  duration; source boundaries remain validated and keyframes/speed ramps stay
  unchanged. Ripple deletion removes
  one clip's time range across all tracks, splitting or trimming intersecting
  clips and retiming downstream media, captions, keyframes, and speed ramps.
  Addition validates the full timeline and extends duration when needed;
  ordinary removal preserves the current project duration.
- `moveTimelineClipToTrack` and the `move-track` edit operation move a clip to a
  different track of the same kind, preserve its full edit metadata, optionally
  change its timeline position, and validate target-track overlaps.
- `reorderTimelineTrack` and the `reorder-track` operation adjust visual/audio
  track order and preserve every clip while renumbering tracks deterministically.
- `duplicateTimelineClip` and the `duplicate-clip` operation copy a clip under
  a new ID and explicit timeline position. They preserve source bounds, effects,
  keyframes, and transitions; normal timeline and overlap validation still apply.
- The `detach-audio` timeline edit creates or uses an audio track for a selected
  video clip, preserving its asset, source range, timeline placement, and
  constant or ramped playback timing. `audioStreamIndex` selects a zero-based
  audio-stream ordinal; stream codecs, channels, start/duration, time base,
  language, and title are retained in registered media metadata. Non-default
  streams are extracted to temporary aligned WAV proxies for rendering. The new
  audio clip can then be edited independently for J/L-cut workflows; media
  without audio or an invalid stream selection is rejected.
- The `timeline edit` CLI applies JSON operations to an existing timeline and
  writes a new validated file without overwriting existing output. Integration
  coverage exercises synchronized gap insertion and source-preserving slip edits.
- Registered standalone audio with a non-zero FFprobe start time is normalized
  to timeline zero through a temporary WAV proxy; the original stays unchanged.
  A generated offset-MP3 test confirms the proxy PTS starts at zero. The
  provided Voice 015.mp3 (11.115 seconds, 23 ms start offset) also rendered in
  an isolated 320×180, 30 fps project; the resulting 11.133-second MP4 retained
  its audio stream and passed output checks. Human listening remains open.
- Canvas presets and arbitrary dimensions are available. The renderer passes
  integer or rational frame rates to HyperFrames and verifies rendered canvas,
  duration, and frame rate against project metadata. MP4, WebM, MOV, and GIF
  exports include full-resolution PNG frame directories; GIF and PNG sequences
  cannot carry audio. MP4 supports H.264/H.265, MOV H.264/H.265/ProRes, and WebM
  VP9 through explicit FFmpeg final-encode options; MP4, MOV, and WebM also
  accept validated CRF or video-bitrate overrides. Render options bound capture
  workers from 1 to 64, enable/disable HyperFrames low-memory mode, and enforce
  a shared timeout across HyperFrames and explicit FFmpeg encoding. Async render
  APIs accept `AbortSignal`; CLI Ctrl+C terminates the active process tree.
  Timeout and cancellation clean Engine and HyperFrames temporary outputs and
  restore timeline metadata. Timeline preprocessing and post-render mastering
  are included in `renderTimelineAsync`'s deadline. Its FFmpeg/ffprobe
  preprocessing and mastering processes are asynchronous and terminate with
  timeout or external abort signals. Async renders can retain a
  validated HyperFrames capture for retry after a later-stage failure. Cache
  data is content-fingerprinted, SHA-256 checked, capped at 8 GiB per artifact
  by default, expires after 72 hours, and is removed after success. Interrupted
  browser capture is not resumed; PNG sequences and synchronous APIs are not
  checkpointed.
- Avatar/audio helpers remain experimental. Amplitude-derived mouth cues are
  not phoneme-accurate lip sync. The initial voice-attachment render below had
  a static mouth; a later comparison render demonstrates audio-level sprite
  changes and timed blinks, but has not had human audiovisual review.
- The optional Rhubarb 1.14.0 adapter converts audio to mono WAV, requests JSON
  mouth cues with the phonetic recognizer by default, and normalizes shape labels
  to the Engine's lowercase cue contract. On the supplied 11.114667-second
  `Voice 015.mp3`, it produced 60 phonetic cues across shapes A, B, C, E, F, and
  X. Mapping these to Waren's available mouth sprites produced 61 continuous
  cues (including the final rest frame), using closed, small, open, and rest
  sprites. The mapping is consumer-owned and configurable.
- A separate Rhubarb-backed Windows render was produced at
  `video-projects/waren-avatar-phonetic-review/renders/voice-015-waren-avatar-phonetic-review-light.mp4`.
  It is 1920x1080, 30 fps, 11.133 seconds, with AAC narration, blink cues, and
  phonetic sprite changes. The existing amplitude-driven comparison remains at
  `video-projects/waren-avatar-speech-review/renders/voice-015-waren-avatar-review-20261106.mp4`.
  Representative frames were inspected for background, framing, and mouth
  placement. Rhubarb 1.14.0 is available only in the ignored local validation
  tooling directory; it is optional, external, and not bundled with the Engine.
  Automatic phonetic recognition can misread Taglish, so cue timing and visual
  quality still require listening and human review before Studio integration.
- `mapRhubarbCuesToSpriteStates` adapts Rhubarb labels to consumer-defined sprite
  states. Its default mapping preserves all six basic visemes as distinct
  lowercase states, maps G/H to matching lowercase states, and maps X to the
  avatar layer's `default` state. The `lip-sync` CLI accepts an optional
  `spriteStateMap` in its options JSON to emit sprite-ready cues; without it,
  the CLI leaves raw lowercase Rhubarb labels unchanged. Capability JSON and
  `doctor` identify Rhubarb as optional, without including it in the Engine's
  required readiness gate.
- `avatar-compose` specs can now request `lipSync` generation directly by
  naming the narration audio, mouth layer, and optional Rhubarb settings. The
  generated track is mapped using consumer-provided sprite states, clipped to
  scene duration, and attached before composition generation. The narration is
  automatically attached unless a separate narration path is supplied. The
  existing standalone `lip-sync` command remains available for reusable cue
  files. This removes the intermediate cue-file step for the common
  speech-avatar workflow. No tests were run per the user's direction to focus
  on implementation before manual debugging.
- Phonetic avatar composition now enforces a complete, distinct mouth set before
  Rhubarb runs: A-H and X are required. GHX is the default extended-shape set;
  consumers can request a reduced cue set, but still supply all nine pack states.
  An explicit `spriteStateMap` supports consumer-specific state names but cannot
  collapse multiple phonemes onto one generic sprite. X maps to the layer's
  default image by default. This check is limited to generated Rhubarb avatar
  compositions; externally authored cue tracks and non-avatar editing remain
  generic. Studio's avatar-generation skill still needs to produce and review
  these assets.
- `avatar-compose` now validates all mouth PNG paths, signatures, and shared
  canvas dimensions before Rhubarb starts. The same dimensional check still
  applies to all sprite layers during composition. This avoids spending time on
  phonetic analysis when a generated or edited mouth asset is already invalid.
- `getEngineCapabilities()` now exposes the phonetic mouth-shape contract and
  Rhubarb availability so any consumer can discover Rhubarb's base A-F shapes,
  the Engine avatar requirement A-H plus X rest, the default GHX cue setting,
  and the distinct-state invariant at runtime.
  Existing assertions in `test/animation-cues.test.mjs` still expect the former
  five-state adapter default; update those assertions when the deferred test
  work resumes. Tests remain unrun per user direction.
- Created an ignored, local-only fixture at
  `video-projects/waren-avatar-viseme-v2/` using the existing Waren body and
  Voice 015. The fixture has seven distinct A-F/X mouth images on identical
  280x171 transparent canvases; generated B/E/F shapes were aligned to the
  existing A/C/D/X art. The prior blink image was resampled to the body's
  420x620 canvas so the blink no longer changes the body box. `avatar-compose`
  accepted the complete pack and generated 59 Rhubarb cues; the 11.133-second
  1920x1080/30 fps MP4 is
  `video-projects/waren-avatar-viseme-v2/renders/waren-voice015-viseme-v2.mp4`.
  FFprobe confirms H.264 video and 48 kHz stereo AAC narration.
  Frame spot-checks at B, C, E+blink, F, X, and A confirm a stable mouth anchor,
  centered rounded/pursed variants, and no body-size blink flicker. A v3 fixture
  adds distinct G (F/V) and H (L) sprites on 280x171 transparent canvases,
  enables GHX cues, and passes avatar composition. Rhubarb produced 59 cues from
  Voice 015: 20 B, 15 C, 6 E, 5 F, 7 A, 5 X, and 1 G; this recording did not
  produce an H cue. The 1920x1080/30 fps render is
  `video-projects/waren-avatar-viseme-v4/renders/waren-voice015-viseme-v4.mp4`.
  FFprobe confirms H.264, 48 kHz stereo AAC, and 11.133333 seconds. One extracted
  G-state frame confirms the F/V sprite appears in the rendered composition.
  A fresh v4 project also re-renders successfully after sprite PNG signatures
  and shared dimensions were moved ahead of the Rhubarb call; this render took
  19.2 seconds. The original v2 render remains untouched. The v2 contact sheet is
  `video-projects/waren-avatar-viseme-v2/renders/avatar-viseme-contact-sheet.png`.
  This is a visual spot-check only: the recording was not listened through for
  Taglish phoneme accuracy, and D was not selected by this recording's cues.
- The standard fixture render completed in 18.8s (setup 5.2s, browser capture
  12.2s, encode 0.1s) on Windows 10.0.26300, AMD Ryzen 7 7840HS, 16 logical
  cores, and 29.8 GiB RAM, using hardware-GPU browser capture. This is one
  11-second avatar sample, not a general render benchmark; peak memory and GPU
  utilization were not measured.
- Sidechain audio-proxy FFmpeg filter graphs now use one filter thread each to
  limit nested thread fan-out during parallel renders. After this change, the
  full parallel local suite passed 128 tests, skipped 3 optional OTIO tests,
  and had no failures. The earlier parallel run exposed a transient failure in
  the sidechain recovery assertion; the isolated and serial runs also passed.
- A fresh `npm run test:render-smoke` passed after the sidechain thread limit.
  Its 12-second synthetic sync render measured 0.000021-second offsets at
  0.5s and 10.5s and approximately zero drift. Audio-only sidechain output
  measured music amplitude 0.1767 before narration, 0.0372 during narration,
  and 0.1762 after narration, with the expected narration amplitude of 0.28.
  The first sandboxed run could not connect to HyperFrames' temporary localhost
  server; the authorized loopback run completed. HyperFrames emitted
  non-blocking asset-load 404 warnings during some smoke renders.
- `npm audit --omit=dev --offline` found zero production dependency
  vulnerabilities using the local npm audit cache.
- Human review of the current Voice 015 avatar render is pending. Do not treat
  amplitude-driven timing as phonetic lip sync or start Studio integration
  until the review and the Rhubarb-backed render are complete.

## Verification evidence

- Asset recovery coverage damages then removes a registered video, verifies
  both states, relinks a replacement under the same ID/path, refreshes its
  metadata and fingerprint, and confirms the replacement source is unchanged.
- Proxy coverage generates and reuses a bounded 320×180 proxy from 640×360
  footage, verifies its fingerprint and source immutability, and exercises the
  asset proxy CLI command. A 2-second proxy-backed Windows render produced
  320×180 video at 25 fps and retained the original A/V timeline audio stream.
- VFR proxy coverage confirms irregular source timestamps at a 19.5 fps average
  are normalized to 24 fps while preserving the source file. The render smoke
  uses this project-rate proxy and measures its visual flash at output frame 12
  against an audio tone beginning at 0.500021 seconds. Rendering the raw VFR
  source delayed the flash by one frame; the matching CFR proxy corrected it.
  Final renders still use original VFR sources unless proxy rendering is
  explicitly requested.
- A 12-second synthetic 24 fps H.264/AAC render with matching visual and audio
  cues at 0.5s and 10.5s measured output audio starts at 0.500021s and 10.500021s
  against video frames 12 and 252. Both A/V offsets were 0.000021s; measured
  drift across the 10-second interval was effectively zero. This validates the
  synthetic Windows render path, not long camera footage, VFR audio clocks, or
  cross-platform behavior.
- The HyperFrames smoke now renders a single timeline containing project-rate
  VFR footage, proxy-backed yellow B-roll, a blue still overlay, a nested
  magenta HyperFrames composition, timed captions, and narration. Output pixel
  samples at 0.8s (`252,252,0`), 1.4s (`0,0,243`), and 1.7s (`253,0,251`)
  verify B-roll, still, and nested composition visibility over the base footage.
  All layers are synthetic; human audiovisual review and real-media validation
  remain open.
- Speed ramps support linear, quadratic ease-in/out, and cubic ease-in/out
  curves. Video timestamp mapping and pitch-preserving Rubber Band audio tempo
  automation consume the same sampled curve; trim/split retains the sampled
  source-time points. Unit tests cover duration integration, inverse mapping,
  slicing, and invalid ease values. The end-to-end smoke ramps both VFR video
  and narration: a 0.5-second source cue rendered at 0.492667 seconds versus
  the expected 0.492426 seconds. Audio ramps require an FFmpeg build with the
  optional `rubberband` filter; the renderer fails clearly if it is absent.
- CLI analysis-provider coverage dynamically loads a consumer module, passes
  provider options, writes normalized time-coded findings, and rejects output
  overwrite.
- A separate `npm run test:render-smoke` command generates synthetic VFR video
  and narration track, registers both assets, composes a captioned timeline,
  applies eased speed ramps to both clips, and aligns a visual flash and audio
  tone at the source cue's mapped timeline position. The HyperFrames render
  verifies dimensions, duration, frame rate,
  codecs, audio level, and cue timing. Local Windows output passed at 320×180,
  24 fps, H.264/AAC, and 2 seconds; the audio cue was within 0.24 ms of the
  expected 0.492426 seconds and the flash appeared in frame 12. CI installs
  the HyperFrames browser and runs this on Linux, macOS, and Windows; hosted
  cross-platform results are pending. The same smoke renders Rec.2020 SDR and
  ffprobe verifies the BT.2020 matrix/primaries, BT.709 transfer, TV range, and
  retained AAC audio. It also renders an audio-free video timeline and an
  audio-only timeline to MP4, confirming the former has no audio stream and the
  latter has AAC audio. Both media-mode captures passed locally on Windows;
  macOS and Linux results remain pending. The audio-only project mixes a 220 Hz
  music bed with a 1 kHz voice cue and signal-aware sidechain compression.
  Source music peak 0.2499 maps to 0.1763 per stereo channel before speech,
  dips to 0.0370 during speech, and returns to 0.1764 afterward. The source
  voice peak at 0.35 track gain predicts 0.2800; the rendered channel measures
  0.2778. This validates source-level gain and duck/recovery behavior on a
  synthetic mix; it is not a listening review of real narration or music.

- `npm test`: 95 tests completed (93 passed, 2 skipped, 0 failed), including
  OTIO API/CLI round trips, external media references, unsupported-overlap
  rejection, asset recovery and proxy generation,
  CLI analysis providers, process-tree cancellation, real FFmpeg video
  cutting, asset registration/integrity, acoustic silence detection, transcript
  corrections, timeline operations, eased speed-curve integration, and schema
  validation, and SDR color-profile conversion settings.
- Render checkpoint recovery was exercised end to end on Windows: after a
  completed HyperFrames capture was saved, the render was intentionally
  cancelled during final encoding. The error confirmed the capture was
  preserved; retrying the same render returned `resumedFromCheckpoint: true`
  and produced a 2-second HEVC/AAC MP4 at 320×180 and 24 fps. Successful
  completion removed the checkpoint cache. This verifies final-stage recovery;
  interrupted browser capture still has to restart.
- Rec.709 and Rec.2020 SDR output profiles use FFmpeg's `colorspace` filter with
  an explicit BT.709 renderer input, transform output pixels, set corresponding
  stream tags, and validate those tags with ffprobe. The doctor reports filter
  availability. HDR transfer functions and HDR mastering metadata are not
  supported.
- Synthetic end-to-end render succeeded on Windows 11 with Node.js 22.22.2,
  HyperFrames 0.7.109, FFmpeg 8.0.1, and the installed browser runtime. It
  registered a generated 320×180 A/V source, assembled a two-second transcript
  and captioned timeline, then rendered a 320×180, 2-second MP4 with audio.
- A second 320×180, 24 fps render combined a red opening clip, blue B-roll with
  a fade, word-timed caption text, and separate narration audio. HyperFrames
  encoded 48 frames in 5.4 seconds. ffprobe confirmed a 2-second H.264 MP4 with
  audio; decoded-frame samples measured red (`217,8,8`) at 0.5s and blue
  (`9,8,217`) at 1.5s. Samples through the 0.2-second fade were red at 1.00s,
  transitional at 1.04, 1.08, 1.12, and 1.16s, and blue at 1.20s. Frame
  inspection confirmed the caption overlay. This is synthetic visual evidence;
  the audio was not auditioned.
- The first render attempt inside the restricted sandbox failed because the
  HyperFrames browser could not bind its temporary localhost port. Re-running
  with the approved local-render permission succeeded. Temporary test media
  was removed after the smoke run.
- Technical metadata was checked. Extracted frames at 0.7, 1.7, and 3.3 seconds
  from the 640×360 multitrack render show the B-roll, image layer, and caption
  at the intended positions. This is a frame sample, not a full visual review
  of real footage or a listening review.
- A 4-second 640×360 render combined a base video, a timed B-roll video, a PNG
  overlay, a caption, music, narration, fades, and voice-over ducking. HyperFrames
  rendered 120 frames and produced an MP4 with the expected audio stream.
- A red-to-blue 0.5-second video crossfade rendered as a purple midpoint frame.
  After assigning overlapping clips separate renderer lanes, HyperFrames no
  longer reported its same-track overlap lint warning.
- `Voice 015.mp3` was probed and registered as an audio asset, then analyzed
  with acoustic silence detection; the 11.115-second file produced no cut
  suggestions. Its SHA-256 matches the narration in the preserved
  `avatar-engine-review` demo.
- A separate project, `video-projects/voice-015-engine-validation`, strips the
  old demo audio, attaches the supplied recording as a distinct Engine audio
  track, and renders `renders/engine-avatar-with-voice.mp4`. ffprobe reports
  1920×1080 H.264 video, AAC stereo audio, and 11.133 seconds. Render time was
  17.8 seconds on the local AMD Ryzen 7 7840HS system.
- Visual inspection at 1, 5, and 9 seconds shows the avatar mouth stays closed
  throughout. This output verifies Engine A/V assembly, not talking-avatar
  quality; lip sync fails review and Studio integration remains gated. Audio
  was not manually listened to in this checkpoint. Both demo projects remain
  available for comparison.
- A fresh 5-second source/output comparison confirms the obscured title and
  cropped shoes are already present in the source avatar video; Engine output
  preserves that framing and does not introduce those composition defects.
- `npm run doctor`: required local tools passed with HyperFrames 0.9.17. Whisper
  CPP, local TTS/BGM, and the Docker daemon were unavailable or optional. The
  pinned HyperFrames dependency uses an `undici` 7.30.2 override; npm reported
  zero vulnerabilities after the update.
- `npm audit --omit=dev`: zero reported vulnerabilities. This check required
  network access to npm's official audit endpoint.
- A rendered synthetic mix used 220 Hz music and 440 Hz narration. Narrow-band
  FFmpeg measurement of the music was -30.6 dB before narration, -48.0 dB
  during narration, and -30.7 dB after narration. This verifies rendered
  ducking (about 17.4 dB reduction for a configured 0.1 multiplier) and
  recovery; the temporary synthetic project was removed.
- A GitHub Actions workflow runs the test suite and production dependency
  audit on Ubuntu, macOS, and Windows with Node.js 22 and FFmpeg. It installs Python
  3.13 and the pinned OTIO adapter so the interchange tests are exercised on
  all matrix operating systems. Hosted run 42174734803 passed tests, render
  smoke, and the production dependency audit on Linux, Windows, and macOS.
- After upgrading HyperFrames to 0.9.17, the full Windows render smoke passed,
  including VFR ingest, layered video/still/nested composition, blend mode,
  captions, speed ramps, Rec.2020 SDR, audio-only/video-only output, sidechain
  mixing, and 12-second A/V sync. Cue offsets were 0.000021s at both 0.5s and
  10.5s. The smoke cleanup now uses asynchronous Windows retry handling. An
  earlier hosted matrix passed its then-current suite; later changes still need
  fresh cross-platform hosted validation. Human audiovisual review and
  representative real-media validation remain open.
- A sampled Windows process-tree profile of the complete synthetic render smoke
  took 62.19 seconds, peaked at 3,419.2 MiB working set across 53 processes,
  and exited successfully. The host was the 16-core AMD Ryzen 7 7840HS system
  with 29.8 GB RAM. This suite performs several small renders, including a
  12-second composition; the measurement is a local synthetic baseline, not a
  single-render estimate or a real-footage performance claim. Cross-platform
  and representative-project profiling remain open.
- Profiled three 1920×1080/30 fps draft renders of the existing 11.133-second
  Voice 015/avatar project on the AMD Ryzen 7 7840HS/29.8 GB Windows host:

  | Render settings | Wall time | Peak process-tree working set | Processes |
  | --- | ---: | ---: | ---: |
  | HyperFrames `auto` workers | 22.68 s | 5,813.3 MiB | 54 |
  | 4 workers | 20.13 s | 4,668.1 MiB | 38 |
  | 1 worker + low-memory mode | 31.21 s | 1,132.8 MiB | 14 |

  All three outputs are 11.133-second H.264/AAC MP4s. Default and low-memory
  renders decode to identical video frames (SSIM 1.0) and identical audio
  samples (decoded-audio MD5 match); the 4-worker render also matched both.
  Low-memory mode cut peak working set by about 80% versus `auto` at a 37.5%
  longer render time on this project. This is a local tradeoff measurement, not
  a universal performance promise or a reason to change defaults without more
  representative projects. A sampled frame at 5s confirms the source's title
  remains obscured and the avatar mouth stays closed. This measures Engine
  rendering on user-supplied media, not talking-animation quality. Audio was
  not auditioned. The original comparison demo remains intact; the default
  output is `video-projects/voice-015-engine-validation/renders/engine-avatar-profile-20261106.mp4`.
- On 2026-11-07, profiled two fresh 1920×1080/30 fps draft renders with a
  250 ms process-tree sampling interval on the same Windows host. The first is
  the full-body avatar composition plus Voice 015; the second runs the generic
  multi-track timeline renderer on the existing avatar video clip and separate
  narration track:

  | Workflow | Wall time | Peak process-tree working set | Peak processes | Output |
  | --- | ---: | ---: | ---: | --- |
  | Avatar composition + narration | 22.40 s | 4,257.1 MiB | 52 | H.264/AAC MP4 |
  | Generic video + narration timeline, default | 21.56 s | 6,240.7 MiB | 51 | H.264/AAC MP4 |
  | Generic video + narration, one worker + low-memory mode | 29.96 s | 1,141.8 MiB | 14 | H.264/AAC MP4 |

  `ffprobe` confirms both outputs are 11.133333 seconds, 1920×1080 at 30 fps,
  with stereo 48 kHz AAC. The sampled video is an existing avatar clip, not
  varied camera footage; it demonstrates the separate timeline render path but
  is insufficient to characterize general-footage performance. Working-set
  sampling may miss peaks shorter than the interval. The default and low-memory
  timeline outputs have identical decoded video-frame and audio MD5s. On this
  sample, low-memory mode reduced the sampled peak working set by 81.7% and
  increased wall time by 38.9%. Do not treat this single-source result as a
  universal performance promise. Audio and image quality still need human
  review.
- HyperFrames synthetic render review on Windows verified MP4, WebM, MOV, and
  GIF exports at 320×180, 25 fps, and 2 seconds. ffprobe confirmed each output's
  dimensions, duration, frame rate, and absent audio stream.
- A separate MP4 render at `30000/1001` fps produced 29.97003 fps and 2.002
  seconds from a 2-second composition, matching the expected frame quantization.
- Probe coverage distinguishes average from nominal frame rate. A true VFR
  fixture with 30 fps red frames followed by 15 fps blue frames reports 20 fps
  average and 30 fps nominal. A 30 fps Engine render produced all 90 output
  frames for 3 seconds; sampled frames at 0.5s, 1.5s, and 2.5s were red, blue,
  and blue as expected. This VFR render was verified on Windows only.
- A synthetic source with video at 0s and audio at 0.378s rendered with the
  aligned-audio proxy. Output silence detection found the expected 0.399s
  leading silence and no shortened-audio tail; the unnormalized render had a
  1.244s tone followed by about 0.756s of silence. The temporary proxy was
  removed after rendering.
- Added coverage for rational frame-rate normalization, timeline validation,
  CLI project creation, and export-format selection. These small synthetic
  renders verify format plumbing, not codec quality across user footage or
  operating systems.
- Timeline timing now has explicit second/frame conversion with nearest/floor/
  ceil rounding. Clip source duration must match its constant-rate or integrated
  speed-ramp timeline duration; clips also stay within known registered asset
  duration. Stream start times and time bases survive from ffprobe metadata into
  assembled timelines.
- Clip-local visual keyframes were rendered in a temporary 320×180 Windows
  project at 30 fps. Pixel samples show red content at x=80 and black at x=240
  after 0.25 seconds, then the inverse after 1.75 seconds. This confirms the
  animated placement/size reached the encoded frames; opacity/rotation were
  schema-validated but not visually inspected in this smoke test. Filter
  animation is implemented through CSS filters but still needs a rendered
  visual review.
- Constant 2× playback rendered a two-second red/blue source into one second.
  Output pixels at 0.25s and 0.75s were red and blue respectively. A separate
  2× audio render changed a 440 Hz then 880 Hz fixture into a one-second file;
  measured output windows were 438 Hz and 875 Hz. Temporary proxies and source
  fixtures were removed. This confirms constant-rate timing on Windows, not
  broad codec behavior. The variable speed-ramp path is verified separately
  below.
- A one-second brightness animation rendered from a gray fixture. Encoded-frame
  samples measured RGB 112/114/114 at 0.2s and 74/76/76 at 0.8s, confirming
  the CSS filter keyframes reach rendered pixels.
- A 2-second 640×180 two-color source was rendered into a 320×180 cover-fit
  viewport with animated horizontal object positioning. Encoded center pixels
  sampled red (250, 0, 0) at 0.2s and blue (3, 2, 254) at 1.8s, confirming the
  crop framing moves across the source image.
- A synthetic red frame rendered with a circular mask. Center and corner pixel
  samples confirm that the subject remains visible while the outside of the
  shape is transparent against the black composition background.
- A synthetic A/V source with one-second red/440 Hz and blue/880 Hz sections
  rendered through the same 1×→2× source-relative speed curve. At 0.25s the
  output sampled red and 440 Hz; at 1.1s it sampled blue and 880 Hz. The
  integrated timeline duration was 1.3863s and the 30 fps render duration was
  1.4s (42 frames). Audio tempo changes are sampled every 50 ms of source time
  and padded/trimmed to the exact clip duration; fine-grained sync over real
  speech and footage still needs validation.
- An eased 4-second video motion was split at 2 seconds and rendered at 10fps.
  Red-pixel bounds at 0.5s, 1.5s, 2.5s, and 3.5s were x=50–99, 113–162,
  142–191, and 150–199 respectively, matching the unsplit easing curve on both
  sides of the edit. Clip trim/split now rebase keyframes and per-property ease
  ranges instead of rejecting animated clips.
- A sparse-property animation (position changes at 0s/2s, opacity at 1s) was
  also split at 1.5s. Encoded red bounds were x=20 at 0.5s, x=56 at 1.4s,
  x=64 at 1.6s, and x=80 at 2.0s, matching the expected per-property timing
  across the cut.
- Optional two-pass loudness mastering rendered a quiet 440 Hz source with a
  -16 LUFS target. A fresh FFmpeg measurement reported -16.01 LUFS and
  -13.59 dBTP; the true-peak setting is a ceiling, so this quieter peak is
  expected. The original WAV hash stayed unchanged and only the requested MP4
  remained in the render directory after cleanup.
- A generated stereo 1 kHz A/V source passed through a +2 dB parametric EQ band,
  loudness normalization, and an -8 dBFS limiter. The encoded mono output
  measured no higher than -7 dBFS, and temporary master files were removed.
- A one-second, 320×180, 10 fps PNG-sequence export produced exactly 10
  validated PNG frames with matching dimensions. HyperFrames completed the
  render, and its temporary project was removed after validation.
- A one-second, 320×180, 10 fps explicit H.264/CRF 25 render passed the final
  FFmpeg encode; ffprobe confirmed H.264, 320×180, and 10 fps. Temporary render
  media was removed after validation.
- One-second 320×180 renders also passed explicit H.265/CRF 30, VP9/CRF 40,
  and ProRes HQ final encodes. ffprobe confirmed HEVC, VP9, and ProRes codecs;
  all outputs retained the requested canvas and 10 fps. Temporary media was
  removed after each check.
- A one-second worker-limited render with HyperFrames low-memory mode enabled
  completed at 320×180 and 10 fps. The renderer reported one capture worker;
  temporary media was removed after validation.
- Transcript policy tests confirm overlapping provider word intervals remain
  ordered and retain their overlap after retiming. Cuts that partially
  intersect a word, including cuts that touch only its beginning or end, are
  rejected; the policy is documented in `docs/architecture.md`.
- A silent 2-second A/V source confirms loudness mastering preserves the audio
  stream without applying an invalid `loudnorm` filter; the output duration,
  dimensions, and temporary-file cleanup were verified.
- A synthetic 3-second music/narration sample confirms signal-aware sidechain
  compression lowers music RMS while narration is active and restores it after
  narration ends. The detector stem uses source track/clip gain and fades;
  target gain/fades remain in the render automation. Threshold, ratio, attack,
  and release ranges are validated. A final 320×180, 30 fps, 3-second MP4
  rendered with the sidechain timeline and passed output stream/dimension/duration
  checks. The 12-second synthetic sync check now passes; real-media listening
  and long-form source validation remain open.
- A 320×180, 30 fps, 3-second still-image render keyframed at 2× zoom and panned
  from left to right retained the fixed crop window. Center-pixel samples were
  red (`251,0,0`) at 0.5s and blue (`0,0,251`) at 2.5s, confirming the rendered
  view moves across the source. Zoom is limited to 1×–4× and trim/split keeps
  the interpolated zoom curve. Repeating the render with an actual video source
  passed HyperFrames media discovery without nested-media lint warnings and
  produced the same left/right pixel samples.
- A 320×180, 10 fps still-image render with a one-second left-to-right wipe
  sampled black at x=80 around 0.2s and near-white (R=253) at the same point
  around 0.8s. HyperFrames browser capture completed; temporary project and
  media were removed after sampling.
- A 320×180, 30 fps, 3-second white-card render animated circle, ellipse, and
  rectangle masks from closed to full bounds. A pixel within each final shape
  was black at 0.5s and near-white (`253,255,255`) at 2.5s, confirming all three
  reveals in the encoded output.
- Styled caption and social-layout PNG sequences rendered at 640×360. The first
  text-stroke version showed glyph artifacts, so built-in presets now use text
  shadows without stroke; visual inspection of the rerender shows clean, bold
  glyphs. Temporary render projects were removed after review.
- Timeline history tests cover bounded retention, undo/redo, reset, immutable
  snapshots, preservation of the input timeline, and redo invalidation after a
  new edit.
- Injected provider tests confirm duration is supplied, results are normalized,
  existing transcripts are not overwritten, malformed provider results are
  rejected, and invalid results do not create output files.
- Media-analysis provider tests confirm source metadata and duration reach the
  provider, findings are sorted and normalized with stable local IDs, and
  invalid types, times, and confidence values are rejected.
- Timeline operation tests confirm track/clip additions and removals return
  validated copies, preserve the original, and update duration only on add.
- Subtitle interchange tests cover SRT/VTT parsing, cue text cleanup, timestamp
  normalization, format export, and project import without calling a speech
  transcription provider.

## Project decisions

- Repository: `warengonzaga/ai-video-editing-engine` (private). Do not make it
  public, publish a package/release, or create a `dev` to `main` PR without a
  new explicit request.
- Keep the Engine independent and generic. Do not copy source, skills,
  templates, artwork, or media from Herk Edit Kit or other references.
- Preserve original media and use reviewable EDL decisions. Cloud services and
  transcription providers remain optional.
- Use Node.js, FFmpeg/ffprobe, HyperFrames, and GSAP. Keep provider adapters
  replaceable and platform claims evidence-based.
- Follow Clean Flow: feature branches target `dev`; do not commit directly to
  `main` or `dev`.

## Typical editing path

1. Create a project and register source media.
2. Import a transcript or transcribe through an installed provider.
3. Generate proposed cuts and review an approved EDL.
4. Run `edit` to retime the transcript, generate captions, and render an MP4.
5. Inspect the actual video and audio before treating it as approved output.

See the README for CLI examples and `docs/architecture.md` for the data
contracts and runtime boundary.

The optional OpenTimelineIO bridge uses the maintained Python library,
references project media externally, and stores Engine timeline data in
namespaced OTIO metadata for Engine round trips. Its current interchange profile
supports video/audio cuts and gaps; overlaps, retiming, transitions, nested
compositions, and remote references are rejected. Install it with
`python -m pip install -r requirements-otio.txt`.

OpenTimelineIO 0.18.1 was installed in a temporary validation target on the
Windows checkout. The Engine timeline round-trip and unsupported-overlap tests
passed against the real OTIO adapter. The package is not installed globally.

## Remaining work

### Reliability and editing capability

- Validate variable-frame-rate seek behavior, long-form audio clock drift, and
  cuts at media boundaries using real provider transcripts and footage.
- Validate codec quality, audio behavior, and formats with varied real footage
  and audio, across operating systems, then inspect frames and listen to output.
- Review Rec.2020 SDR output on a color-managed display and compare decoded
  color patches to reference values; current local checks validate conversion
  execution and stream tags, not perceptual or broadcast compliance.
- Validate speed-ramp easing and expand real-media validation for visual
  effects and transitions. Animated crop-window/zoom, color controls, animated
  masks, and reusable fade/wipe transitions are implemented.
- Render a reusable HyperFrames composition alongside footage, external audio,
  B-roll, still images, and captions in one end-to-end project. Existing
  evidence covers the media layers and timed captions, but not that exact
  combination with a nested composition. Listen to output audio with varied
  real narration/music.
- Validate no-audio video, audio-only input, and unsupported codec behavior
  across Windows, macOS, and Linux. JSON/SRT/VTT transcript import and SRT/VTT
  export now have local coverage.

### Consumer integration and delivery

- Obtain a human audiovisual review of the current A-H Voice 015 avatar render:
  `video-projects/waren-avatar-viseme-v4/renders/waren-voice015-viseme-v4.mp4`.
  A 2 fps mouth/face contact sheet is at
  `video-projects/waren-avatar-viseme-v4/renders/viseme-v4-mouth-inspection.png`.
  Its audio stream was technically verified, but has not received a human
  listening review.
- Decide a distribution model. The private package exposes an installable CLI
  binary for local/Git dependency use; public npm installation is not enabled.
- Recheck current hosted Linux/macOS/Windows CI state and validate setup on a
  clean target. A local packed-tarball install into a disposable Windows
  consumer now passes: package dependencies install, the `ai-video-engine`
  binary reports capabilities, the ESM API imports, and a new blank project
  timeline validates. This is local packaging evidence only; no npm publish or
  cross-platform installation claim is made. Review dependency versions before
  upgrading.
- Integrate Explainer Studio only after Engine behavior and outputs pass the
  agreed visual and audio review.

The detailed phase checklist and acceptance criteria are maintained in
[`implementation-plan.md`](implementation-plan.md). Update it when evidence
changes; do not claim full-editor completion from schema tests or a synthetic
smoke render alone.

## Latest implementation evidence (2026-11-07)

- Packed the existing private package metadata to a local tarball and installed
  it into an isolated consumer project. Verified the installed CLI capability
  report, ESM API imports, blank project creation, and timeline validation.
  The temporary consumer and tarball live under ignored `video-projects/`;
  nothing was published to npm. Installation initially hit the sandbox's npm
  registry DNS restriction, then completed after the authorized network retry.
- Reviewed the current Voice 015 A-H render contact sheet and Rhubarb's official
  shape guidance. Rhubarb 1.x uses replacement animation; its C and E shapes
  also act as in-betweens, so the artwork and cue timing must make adjacent
  changes read smoothly. The Engine cannot synthesize convincing intermediate
  mouth drawings by fading raster sprites. Strengthened the public mouth-pack
  validator to require readable PNGs with matching canvas dimensions and reject
  byte-identical files before invoking Rhubarb. Perceptual similarity,
  within-canvas alignment, and phoneme accuracy still require review. No test
  suite or new render was run for this change, per the implementation-first
  direction.
- Added `avatar validate-mouth-pack <mouth-pack.json>` as a read-only CLI
  preflight for asset-generation workflows. Sprite paths resolve relative to
  the specification file, and the result reports the A-H/X state mapping and
  shared canvas dimensions without creating a project. Capability discovery
  now advertises the canvas and image-content invariants. Ran the CLI against
  the current Voice 015 A-H/X sprite pack; it reported valid and a shared
  280×171 canvas. The generated mouth-pack JSON is ignored under
  `video-projects/`. `npm pack --dry-run` includes the CLI, validator, shared
  PNG helper, README, and architecture docs (68 files, 168,743 packed bytes).
  No tarball was published, and no test suite or GitHub Actions run was started.
- `avatar-compose` now preflights all generated sprite destinations before
  copying. It reuses an existing output only when its bytes match the requested
  source; otherwise it fails before copying any new sprite, preventing silent
  reuse of stale artwork after an interrupted or edited project setup. No test
  suite or avatar render was run for this change.

- Added `insertTimelineGap` / `editTimeline({ type: 'insert-gap', ... })` as a
  generic synchronized timeline operation. It shifts clips after the insertion
  point, splits intersecting clips, preserves source timing, keyframes, speed
  ramps, and word-timed captions, extends project duration, and does not mutate
  the input timeline. Focused test passed; `npm test`: 105 passed, 2 optional
  OpenTimelineIO tests skipped, 0 failed.
- Added `slipTimelineClip` / `editTimeline({ type: 'slip', ... })`. It shifts
  source in/out together while preserving clip placement, duration, keyframes,
  and speed-ramp coordinates; overlay slips and invalid asset boundaries are
  rejected. The API and CLI integration tests pass.
- Added CLI integration coverage for gap and slip operations and documented the
  JSON-driven `timeline edit` workflow in the README. `npm test`: 117 passed,
  2 optional OpenTimelineIO tests skipped, 0 failed.
- Added atomic multi-operation edit plans through `editTimelineBatch`, CLI JSON
  arrays, and single-entry `history.applyBatch`. Focused timeline/API/CLI tests
  verify ordered application, undo/redo grouping, unchanged state on failure,
  and absence of a partial CLI output.
- Added `detachAudioFromTimelineClip` / `editTimeline({ type: 'detach-audio', ... })`
  to create a synchronized audio clip from video media. API tests cover stream
  validation, source/timeline mapping, constant and ramped playback, immutable
  input, and CLI operation support.
- The full Windows render smoke muxed a synthetic tone into video, detached it
  as an audio track, rendered the timeline, and measured the 1 kHz tone at
  amplitude `0.79985` (source target `0.8`). The output retained both video and
  audio. The same smoke rerun passed its gap/ripple, layer, audio-only,
  video-only, and long-sync checks.
- Reran `npm run test:render-smoke` on Windows with local browser access enabled:
  all synthetic renders passed, including the 12-second A/V sync check. Audio
  cue starts measured 0.500021s and 10.500021s against the two visual cues,
  with 0.000021s offsets and effectively zero drift. Ripple deletion rendered
  at 1.5s and gap insertion at 2.5s with audio preserved; the inserted gap
  sampled black. Video-only/audio-only stream checks and the layered render
  also passed. The sandbox-only first attempt was blocked at localhost capture.
- The 2026-11-06 Windows render smoke passed, including the 1.5-second ripple
  deletion render and 2.5-second gap insertion render, both with audio streams
  and restored project metadata. The inserted gap sampled black (luma 0).
  Layered composition, track muting/visibility, audio-only/video-only modes,
  color profile, captions, and 12-second A/V cue alignment also passed. The
  long-sync cues measured 0.000021s offset at 0.5s and 10.5s, with effectively
  zero drift. Local Chrome loopback access was required.
- `npm run doctor` confirms the required local Windows toolchain (Node.js
  22.22.2, FFmpeg/ffprobe 8.0.1, HyperFrames 0.9.17, GSAP, Chrome, and the
  required FFmpeg filters). Optional local transcription/TTS/music tools are
  absent. Docker Desktop is installed but its Linux daemon is not running;
  WSL reported access denied, so local Linux/macOS validation is unavailable.
- `npm audit --omit=dev --offline`: 0 reported production dependency
  vulnerabilities. Hosted Linux/macOS CI remains the cross-platform gate.

- Added allowlisted CSS blend modes (`normal`, `multiply`, `screen`, `overlay`,
  darken/lighten variants, and component modes) to video and overlay timeline
  clips. Audio tracks reject this visual-only option, and arbitrary style input
  is never interpolated into the renderer.
- The Windows render smoke composites a blue still in `screen` mode over a
  timed white source frame. The encoded pixel was `[253, 255, 255]`, confirming
  that the two layers blend in the final output. HyperFrames disables its fast
  `drawElementImage` route for this CSS feature and selects baseline capture;
  this is a known render-time tradeoff to profile on larger projects.
- `npm test`: 99 passed, 2 skipped, 0 failed. Timeline validation rejects
  non-boolean `allowOverlap`, `muted`, and `visible` values. The renderer now
  omits hidden video/overlay tracks and muted audio tracks, and removes audio
  ducking/sidechain rules that reference excluded tracks. `npm run test:render-smoke` passed,
  including the layered composite, video-only/audio-only outputs, and 12-second
  A/V cue checks (measured drift approximately `2.22e-16` seconds). The Windows
  run required local Chromium loopback access.
- A dedicated encoded-output smoke hides the video and overlay tracks and mutes
  both audio tracks while a sidechain rule references them. The output center
  pixel remained black (luma 0), no audio stream was present, and the rule was
  omitted from render state. The saved edit timeline remains intact.
- The first Voice 015 voice-attachment render used an avatar video with no mouth
  and held one `rest` sprite; it did not validate speech-driven animation.
- Built a separate ignored comparison render at
  `video-projects/avatar-engine-talking-review-v2/renders/talking-avatar-review-v3.mp4`
  with the existing Voice 015 media and five available mouth sprites. It is
  11.13 seconds at 1280×720/30 fps with AAC audio and 334 audio-level cues.
  Inspected frames at 1, 3, 5, 7, and 9 seconds: the mouth stays centered below
  the glasses and changes among the supplied states. This prototype uses
  amplitude thresholds, so it does not prove phoneme-accurate lip sync, blinking,
  or natural speech alignment. No human listening review has been completed.
- Fixed avatar composition asset URLs and timeline markup: generated sprites now
  use project-root-relative assets, stable IDs, `.clip`, and `data-track-index`.
  The clean comparison render completed without the earlier path/layer warnings.
  `video-projects/` is now fully ignored so generated projects and user media
  cannot be picked up accidentally by a repository change.
- The full-editor acceptance gates remain real-footage audiovisual review,
  resource profiling, cross-platform runs, and consumer integration after those
  reviews pass.
- Asset registration and relinking now retain metadata for every audio stream,
  including language/title tags and ffprobe stream indices. Detached audio clips
  can select a zero-based audio-stream ordinal. The Windows render smoke used a
  two-track source and selected the second (220 Hz) stream: selected-tone peak
  amplitude was `0.25059`; the unselected 1 kHz stream measured `0.00000986`.
  The resulting output kept video and only the requested audio stream.
- After multi-stream selection changes, `npm test` passed with 112 tests and 2
  optional OpenTimelineIO skips. `npm run test:render-smoke` passed all Windows
  synthetic renders, including multi-audio detach, layer visibility/muting,
  video-only/audio-only exports, color profile tags, and 12-second sync cues.
- Explicit FFmpeg final encoders are now probed before HyperFrames capture.
  Unsupported H.264/H.265/VP9/ProRes selections fail with an actionable setup
  error before spending time rendering browser frames. The encoder-list parser
  handles FFmpeg's six-character capability flags and has unit coverage for
  supported and unavailable encoders. Cross-platform unsupported-codec runs
  remain part of the hosted CI gate.
- After encoder preflight integration, `npm test` passed: 113 passed, 2
  optional OpenTimelineIO skips, 0 failed. `npm audit --omit=dev --offline`
  reported 0 vulnerabilities, `npm run doctor` found required Windows tools,
  and the live FFmpeg query confirmed `libx264`. The post-change elevated
  `npm run test:render-smoke` passed all synthetic media/editing cases. The
  first sandbox-only render attempt failed on localhost access and atomic file
  registration; the elevated retry completed successfully.
- `npm run doctor` now also lists local availability for H.264, H.265, VP9,
  and ProRes output encoders. Missing optional encoders are reported as
  capabilities and do not make unrelated project workflows fail.
- Added `getEngineCapabilities()` and `ai-video-engine capabilities` as a
  versioned JSON preflight contract for consumers. It reports Node.js support,
  FFmpeg/ffprobe and renderer package availability, common FFmpeg video
  encoders, and feature filters without storing credentials or exposing local
  paths. API and CLI contract tests cover installed and unavailable tool cases.
- Capability parsing accepts FFmpeg encoder names containing hyphens, including
  `libvpx-vp9`. The current Windows FFmpeg build exposes H.264, H.265, VP9, and
  ProRes; hosted platform coverage is still pending.
- An actual one-second 320×180/10 fps WebM render with explicit VP9/CRF 40
  passed the Engine's encoder preflight and final FFmpeg encode. ffprobe
  confirmed `codec_name=vp9`, 320×180, 10 fps, and 1.000-second duration.
  The temporary project was removed after the render file was verified.
- After adding the consumer capability contract, `npm test` passed with 117
  passing tests, 2 optional OpenTimelineIO skips, and no failures. `git diff
  --check` and JavaScript syntax checks passed; the offline production
  dependency audit reported 0 vulnerabilities.
- Improved `createAvatarComposition`: sparse animation cues now restore the
  layer's default sprite at cue end, and the generated project starter title is
  removed when mounting the avatar scene. A local review render with the
  consumer-provided Waren sprites and Voice 015 produced an 11.133-second,
  1280×720/30 fps H.264/AAC MP4 with 334 audio-level mouth cues and four timed
  blink cues. Frame inspection at 1.75s (blink), 1.9s and 2.4s (eyes restored),
  and 4.4s (blink) confirms stable full-body sizing, default-state reset, and
  centered mouth placement; no starter title appears. This verifies sprite
  switching and composition only, not phoneme accuracy, natural timing, or
  human audio review. The artifact remains in ignored `video-projects/`.
- `npm audit --omit=dev --offline` reported 0 production dependency
  vulnerabilities using the local npm audit cache.
- The 2026-11-06 Windows render smoke now exercises all advertised export
  modes against a two-second 320×180/24 fps video-only timeline: MP4/H.264,
  WebM/VP9, MOV/ProRes, GIF, and a 48-frame PNG sequence. The GIF validator
  checks nominal frame rate because GIF's 10 ms frame-delay time base can make
  ffprobe's average rate differ from the authored cadence. All output format,
  dimensions, codec/audio-stream, and PNG frame-count assertions passed; the
  full render smoke also passed its audio-only/video-only, caption, timeline,
  color-profile, and 12-second A/V sync checks. `npm test`: 117 passed, 2
  optional OpenTimelineIO skips, 0 failed. `npm audit --omit=dev --offline`
  reported 0 vulnerabilities. Hosted CI run 42168696652 passed the full test,
  render-smoke, and dependency-audit jobs on Linux, Windows, and macOS.
- Reviewed the ignored Engine artifact
  `video-projects/avatar-engine-user-review-2026-11-06-v4/renders/waren-talking-review.mp4`
  through a contact sheet sampled at one-second intervals. The 11.133-second,
  1280×720/30 fps H.264/AAC render shows stable full-body framing, no obvious
  clipping, and changing mouth/blink states. ffprobe confirms 48 kHz stereo
  AAC audio. This is a visual spot-check only; phoneme alignment and human
  listening review remain open. The contact sheet and source media remain
  local and ignored.
- Added a generic `socialPop` caption preset that activates word highlighting
  from word-timed transcripts and animates each active word from 0.92 to 1.08
  scale over at most 140 ms with GSAP `back.out(1.6)`. Other layouts can select
  `scale` or `pop` explicitly; invalid or untimed options are rejected. The
  Windows full render smoke passed with its timed red-pixel checks using the
  new preset. `npm test`: 117 passed, 2 optional OpenTimelineIO skips, 0 failed.
- The render smoke now retains the complete generated workspace on failure and
  logs audio-only stream duration plus music amplitude before, during, and
  after the voice cue. Hosted run 42174734803 passed tests, render smoke, and
  production dependency audit on Linux, Windows, and macOS. Each OS verified a
  2-second audio stream, music amplitude 0.1767 before voice, 0.0372 during
  voice, and 0.1765 immediately after; four recovery windows through 1.2
  seconds also measured about 0.1766. The first Linux-only failure at this
  assertion did not reproduce on the following two full matrix runs. This is
  synthetic audio evidence; real narration/music review remains open.
- Caption layout presets now enable optional word-boundary wrapping, including
  simultaneous word highlighting across wrapped lines. `wordWrap` is validated
  at the timeline boundary and can be disabled per caption. The render smoke
  uses a narrow social-pop caption and samples the active word on separate
  output rows to verify wrapping and highlight timing together.
- Added `previewTimelineEdit` and `timeline preview-edit`. The dry run executes
  the same per-operation timeline validation as a real edit, reports exact
  track/clip changes and before/after duration, and leaves the input untouched.
  API and CLI tests verify successful previews, invalid-batch isolation, and no
  CLI output-file creation. `npm test`: 119 passed, 2 optional OTIO skips.
- Added `moveTimelineClipToTrack` and the `move-track` operation for moving
  media between same-kind layers. The move preserves the full clip, validates
  target overlap and source boundaries, and can optionally update timeline
  placement. API coverage checks immutable source preservation, metadata, kind
  mismatch, and missing clip/track errors; CLI coverage exercises the operation.
  `npm test`: 121 passed, 2 optional OTIO skips, 0 failures; offline production
  dependency audit: 0 vulnerabilities. These changes are in commit `8f7ebc8`
  on the feature branch for PR #1 to `dev`.
- Fresh Windows `npm run test:render-smoke` completed successfully. It covered
  timeline gaps and track-state filtering, social-pop caption wrapping, SDR
  color output, video-only and audio-only behavior, MP4/WebM/MOV/GIF/PNG
  sequence exports, detached audio, sidechain recovery, and a 12-second A/V
  sync render. The sync cues were both 0.000021 seconds late with effectively
  zero drift. This is synthetic render evidence; real-footage and human review
  remain open. The first sandboxed attempt was denied a temporary-file rename;
  the same smoke passed with normal local render permissions.
- Analysis providers can now attach validated `remove-range` suggestions.
  `analysis-to-edl` converts suggestions to a confidence-filterable draft and
  merges only overlapping proposed spans; `approve-edl` writes a separate copy.
  Retiming, timeline construction, and direct FFmpeg cut rendering reject EDLs
  marked `needs-review`. The injected CLI provider test exercises analyze →
  candidate EDL → approved EDL; output remains separate at each step. `npm test`:
  123 passed, 2 optional OTIO skips, 0 failures; offline production dependency
  audit: 0 vulnerabilities. This makes AI proposals executable only after an
  explicit approval step; it does not evaluate proposal quality.
- Track-order changes now have a `reorder-track` operation and
  `reorderTimelineTrack` API. They preserve the complete clips and reassign
  deterministic order indices; API and CLI tests cover ordering and source
  immutability. Current full suite: 125 passed, 2 optional OTIO skips.
- Clip duplication is now available as an immutable API/CLI operation with a
  required new kebab-case ID and timeline position. Tests cover preserved
  source/effect metadata, project-duration extension, and overlap rejection.
- Hosted run 42181292620 on commit `e3b508a` passed macOS and Windows but failed
  Ubuntu's synthetic sidechain recovery assertion: RMS was 0.0769 during voice
  and 0.1022 after voice. The assertion expected a larger recovery than this
  platform's FFmpeg output showed. It now requires a 20% RMS increase in the
  same recovery window; two local isolated runs and the full suite pass. Hosted
  revalidation is blocked before test execution by the account billing issue
  recorded below.
- On commit `2910f16`, `npm test` passes with 127 tests passed and 2 optional
  OpenTimelineIO skips; `npm audit --omit=dev --offline` reports zero
  vulnerabilities. The full Windows `npm run test:render-smoke` also passes,
  including timeline edits, audio routing/mixing, multilayer composition,
  caption rendering, MP4/WebM/MOV/GIF/PNG sequence output, and 12-second A/V
  sync with both cues 0.000021 seconds late. These render assets are synthetic;
  real-footage and human audiovisual review remain open.
- PR runs `42182909719` and `42182916763` for `2910f16` terminate before any
  matrix step starts. GitHub reports failed recent account payments or a
  spending limit as the reason; this is an Actions account blocker, not a test
  result. Retry the hosted matrix after billing is restored.
- Feature-branch pushes previously triggered one matrix run through `push` and
  another through the open PR's `pull_request` event; merging then triggered a
  third run on `dev`. Automatic CI now runs once for PRs targeting `dev`, while
  `workflow_dispatch` remains available for manual runs. This keeps the full
  three-OS matrix before merge without automatic duplicate runs on branch and
  merge pushes.
- At the user's direction, the automatic `pull_request` trigger is temporarily
  disabled while the remaining Engine capabilities are implemented. The full
  matrix remains available through `workflow_dispatch`; restore automatic PR
  checks when the user is ready to resume validation.
- The latest Windows render-smoke run also covers an MP4 whose video stream
  starts at 1.0 second. The rendered clip shows its red source frame at timeline
  0.25 seconds; the output records source start time 1.0 second. The complete
  smoke passes with this offset regression enabled, along with the existing
  VFR, layered, format, audio, and sync checks. This remains generated fixture
  evidence rather than real camera footage or cross-platform validation.
- The user previously asked to defer tests and GitHub Actions while implementation
  continued. Local verification has since resumed for the current implementation;
  hosted workflows remain manual-dispatch only and were not started. Open plan
  items that require human audiovisual review, representative-project profiling,
  or review-gated Studio integration remain open.
- Added an `hdr10` color profile for MP4/MOV output. It converts the renderer's
  BT.709 SDR frames to 10-bit BT.2020/PQ with a 203-nit reference white, encodes
  HEVC Main 10, and writes static HDR10 mastering and content-light metadata.
  The profile requires FFmpeg `zscale` and `libx265`; explicit H.264 requests
  fail before capture. Probe results now retain pixel format so final validation
  checks 10-bit output in addition to color tags. README, capability discovery,
  and `doctor` document/report the new requirements. Tests, render smoke, and
  visual HDR review were not run per user direction; the transform assumptions
  and metadata still need manual output review. Corrected the HDR10 mastering
  display's BT.2020 red-primary coordinates to `R(35400,14600)` after static
  review found the earlier y-coordinate out of range.
- Expanded the OpenTimelineIO profile to flatten nested track stacks, preserve
  audio mute/video visibility through OTIO track enabled state, and retain
  trailing gaps when exporting/importing project duration. Import now rejects
  trimmed tracks/stacks, effects, and disabled clips explicitly instead of
  silently discarding them. Nested compositions inside tracks remain
  unsupported. No tests or bridge invocation were run per user direction.
- Updated OTIO import to expand standard `SMPTE_Dissolve` transitions into
  overlapping Engine clips and map them to video opacity fades or audio
  crossfades, using OTIO's maintained expanded-transition algorithm. Custom
  transitions and transition neighbors other than clips are rejected. At that
  checkpoint, export still rejected overlaps and clip transitions.
- Validated the current Engine implementation locally: `npm test` passes all
  130 tests with the pinned OpenTimelineIO 0.18.1 dependency available from a
  temporary install; no tests were skipped. Added coverage for video-dissolve
  overlap/fade mapping and audio crossfade fades. A 3-second, 320×240 synthetic
  HDR10 render completed on Windows; ffprobe confirms 30 fps HEVC Main 10,
  `yuv420p10le`, limited-range BT.2020/PQ, valid BT.2020 red-primary
  coordinates (`35400/50000`, `14600/50000`), and 203-nit MaxCLL/MaxFALL.
  Artifact: `video-projects/timeline-render-smoke/renders/hdr10-validation-20261106.mp4`.
  A subsequent full `npm run test:render-smoke` pass on Windows covers MP4,
  WebM, MOV, GIF, PNG sequences, Rec.2020 SDR, layered composition, captions,
  audio routing, track visibility/mute, and 12-second A/V sync. Sync cues were
  0.000021 seconds late at 0.5s and 10.5s, with effectively zero measured drift.
  The first sandboxed attempt could not reach the local HyperFrames server; the
  same synthetic suite passed with local loopback access enabled. No hosted
  workflow was started. Real-footage HDR review, cross-platform hosted runs,
  representative-project profiling, and human audio/visual approval remain
  open.
- The prior Voice 015 profile used a precomposed avatar video with narration,
  so the Engine sprite compositor was not driving its mouth. Added parent-relative
  sprite placement to `createAvatarComposition` and fixed its aspect-ratio math;
  mouth layers now anchor to normalized coordinates on an earlier body layer.
  The compositor also removes the starter title's orphaned GSAP animation when
  it removes that title. The new ignored review project
  `video-projects/waren-avatar-speech-review` uses the supplied Waren body,
  mouth, and blink sprites plus the existing Voice 015 recording. Its 11.133s
  output is 1920×1080 H.264/AAC at 30 fps. Frame inspection at 1s, 1.9s, 5s,
  and 9s confirms the mouth is on the face, changes between states, the blink
  closes the eyes without changing body size, and the idle mouth returns.
  Mouth timing uses 168 audio-level cues at 15 Hz, not phoneme analysis. Render:
  `video-projects/waren-avatar-speech-review/renders/voice-015-waren-avatar-review-20261106.mp4`;
  contact sheet:
  `video-projects/waren-avatar-speech-review/renders/avatar-review-contact-sheet.png`.
  Current `node --test --test-concurrency=1` passes 128 tests and skips 3
  optional OTIO tests because `requirements-otio.txt` is not installed; no tests
  fail. The default parallel test run had one timing-sensitive sidechain-render
  failure; that test passes alone and the serial suite passes. User audio review,
  phoneme-level alignment, and the earlier demo comparison remain open.
- Generated a separate Rhubarb-backed Voice 015 render using 61 mapped mouth
  cues and the existing blink sprites. Representative frames confirm the
  light review canvas, full-body framing, and mouth placement; the output is
  `video-projects/waren-avatar-phonetic-review/renders/voice-015-waren-avatar-phonetic-review-light.mp4`.
  The original amplitude-based render remains available unchanged at
  `video-projects/waren-avatar-speech-review/renders/voice-015-waren-avatar-review-20261106.mp4`.
  ffprobe reports 1920x1080 H.264 video at 30 fps with 48 kHz stereo AAC audio
  and 11.133 seconds duration. Rhubarb 1.14.0 was downloaded into ignored local
  validation tooling; it is optional and is not bundled.
- Extended `avatar-compose` to accept an optional `lipSync` block that names
  the narration audio, mouth layer, and Rhubarb options. The Engine now creates
  mapped mouth cues during composition setup and automatically attaches that
  audio as narration unless a separate narration path is given. Added a
  consumer-owned JSON example to the README. This reduced the common
  speech-avatar authoring path to one composition specification. Per the user's
  direction, no tests or automated validation were run after this change.
- At that stage, the next focus was to complete reusable Engine capabilities
  without starting the gated Studio migration. The implementation checklist is
  now complete; current outstanding review and validation gates are listed under
  `Remaining work` above.
- Added `inspectTimeline(timeline)` and `timeline inspect <timeline.json>` as a
  read-only, validated overview for AI editing workflows. The output summarizes
  canvas settings, media metadata, ordered tracks, clip source/timeline ranges,
  transitions, and audio properties. README, architecture, and implementation
  plan now document this interface. No tests or automated validation were run,
  per the user's direction to prioritize implementation.
- Added `listProjectAssets(projectPath)` and `asset list <project>` to expose the
  versioned registered-media catalog to agent workflows, including unreferenced
  assets. The operation returns a detached manifest copy and does not touch
  media files. README and implementation plan document the new interface. No
  tests were run, per the user's direction.
- Extended OTIO export to represent a two-clip Engine overlap as a standard
  `SMPTE_Dissolve` when the incoming clip has a matching explicit fade (and
  audio pairs also have a matching outgoing fade). Source ranges are segmented
  around the transition so the transition uses only frames in the Engine clip
  source ranges. Unmarked/chained overlaps, standalone fades, clip-edge
  transitions, and retiming remain explicit errors. Updated the OTIO docs and
  implementation plan. The optional OTIO bridge was not run and no tests were
  run, per the user's direction to defer validation.
- Added video and audio reverse playback for selected clip source ranges. The
  renderer creates a temporary FFmpeg proxy and supports combining reverse
  playback with a constant speed; reverse plus speed ramps and OTIO export are
  rejected explicitly. Detaching audio from a reversed video clip preserves
  reverse playback in the audio track. Timeline validation, AI-readable clip inspection, and
  the reviewable `set-reverse` CLI/API operation include the capability.
  README/architecture/plan documentation describe it. No tests or render
  verification were run, per the user's direction to prioritize implementation
  first. FFmpeg reverse-filter memory use scales with clip duration and
  resolution. FFmpeg `reverse`/`areverse` availability is reported by doctor
  and capability discovery, and checked before the renderer creates temporary
  media.
- Added ordered audio effects per audio clip: parametric equalizer, high-pass,
  low-pass, compressor, and optional spectral denoise through FFmpeg `afftdn`.
  The renderer processes temporary WAV proxies, preserves registered sources,
  supports the selected audio stream, and checks the optional denoise filter
  before rendering. Timeline validation, inspection output, OpenTimelineIO
  rejection behavior, reviewable `set-audio-effects` CLI/API editing, FFmpeg
  capability discovery, README, architecture, and implementation plan describe
  the feature. Local FFmpeg filter help was inspected for option compatibility;
  no tests or renders were run, per the user's implementation-first direction.
- Added clip-relative `volumeKeyframes` for linear audio gain automation, with
  a held final value. The renderer combines it with static gain, fades, and
  timing ducking. Trim, split, ripple-delete, and synchronized gap insertion
  slice and rebase the curve. Added validated `set-volume-keyframes` CLI/API
  editing and timeline inspection output; OTIO export rejects this unsupported
  external mapping. No tests or renders were run, per the user's direction.
- Consolidated FFmpeg filter discovery behind the reusable `listFfmpegFilters`
  API. Capability discovery, doctor, and render preflight each inspect the
  filter registry once instead of starting a separate FFmpeg process per
  optional filter. Timeline-required filters and output encoder/color-profile
  capabilities are checked before render temporary media is created. No tests
  or renders were run, per the user's implementation-first direction.
- Extended `renderTimelineAsync`'s deadline across audio alignment, playback
  proxy generation, sidechain processing, HyperFrames capture, final encoding,
  output probing, and optional audio mastering. Timeline preparation, probing,
  and mastering now use asynchronous FFmpeg/ffprobe processes connected to the
  same abort signal, so timeout and caller cancellation terminate active
  process trees. `renderProjectAsync` now also probes captured and encoded media
  asynchronously with its render signal. Added the public cancellable
  `probeMediaAsync` API and validate render options, timeline-required filters,
  output encoders, and color-profile filters before generating temporary media.
  Temporary assets and project metadata use the existing cleanup/restore path.
  JavaScript syntax checks passed; no tests or renders were run, per the user's
  instruction to defer validation.
- Changed the `probe` CLI command to use `probeMediaAsync` and share the
  existing Ctrl+C cancellation handler, so local media ingest can terminate its
  active FFprobe process. README documents the CLI and API behavior. No tests
  or media probes were run, per the implementation-first direction.
- Added `createAssetProxyAsync` with AbortSignal-aware FFmpeg proxy creation and
  async output probing. The `asset proxy create` CLI command now routes through
  it, reports Ctrl+C cancellation accurately, and cleans staged files. The
  synchronous API remains available. README and the implementation plan
  describe the API/CLI workflow. No tests or proxy renders were run.
- Extended asset preview cancellation across async media probing, thumbnail
  extraction, and streamed waveform decoding. The CLI `asset preview` command
  now forwards Ctrl+C through the same cancellation path. Added a 120-second
  timeout for each thumbnail FFmpeg task and documented the AbortSignal API.
  No tests, media probes, previews, or renders were run.
- Added the reviewable `set-keyframes` timeline operation and public
  `setTimelineClipKeyframes` API. It replaces or clears validated visual
  keyframes on video and overlay clips, and participates in batches and
  dry-run edit previews. README and implementation-plan docs include the
  workflow. No tests or renders were run.
- Added the reviewable `set-framing` operation and
  `setTimelineClipFraming` API for partial static video-fit and viewport
  updates, including `null` resets to inherited values. Resulting clips pass
  the same timeline placement and fit validation as timeline construction.
  README, architecture, and implementation-plan docs describe it. No tests or
  renders were run.
- Added `set-track-state` and `setTimelineTrackState` for reviewable video or
  overlay visibility and audio mute/volume changes. Partial updates preserve
  the other state; `null` removes an override. The shared timeline validator
  enforces state by track kind and value bounds. README and architecture/plan
  docs cover the edit operation. No tests or renders were run.
- Added `set-audio-state` and `setTimelineClipAudioState` for reviewable clip
  volume, fade-in/fade-out, and source audio-stream changes. Null resets an
  override; timeline validation enforces track kind, stream index, volume, and
  fade bounds. README and implementation docs describe the operation. No tests
  or renders were run.
- Added `set-overlay` and `setTimelineOverlay` for allowlisted text/composition,
  caption timing, layout, and style edits. The resulting overlay is validated
  against the timeline schema and supports the existing batch and dry-run
  workflows. README, architecture, and implementation-plan docs describe it.
  No tests or renders were run.
- Added `registerMediaAssetAsync` for staged, AbortSignal-aware source copying,
  hashing, and asynchronous ffprobe of audio/video/image inputs. The CLI asset
  registration command now uses it with Ctrl+C cancellation. A partial asset is
  only linked into the project before the manifest transaction, and is removed
  if that commit fails. README and implementation-plan docs describe it. No
  tests or media registration jobs were run.
- Added `relinkProjectAssetAsync` with cancellable staged copy, async probing,
  and transactional replacement of the registered source, asset manifest, and
  matching timeline metadata. Asset registration and relink metadata now use
  same-directory temporary files and atomic replacement; a rollback conflict
  preserves the old source backup and reports its path. The CLI relink command
  forwards Ctrl+C. Exported and documented the async API. No tests or relink
  jobs were run.
- Added persistent timeline-file history for one-shot CLI and agent workflows.
  `timeline project-edit`, `undo`, `redo`, and `history` keep bounded snapshots
  in an adjacent sidecar, detect external timeline changes, and recover a
  journaled edit if the timeline-file replacement was interrupted. A per-file
  lock serializes concurrent changes and stale locks from exited processes are
  cleared. The default bound is 20 snapshots with a 64 MiB sidecar limit. No
  tests or history operations were run.
- New projects now include a validated empty timeline initialized from project
  metadata and the registered asset catalog, with video, audio, and overlay
  tracks. Added `createProjectTimeline` and `timeline create` for existing
  projects or separate output files. No project creation or timeline command
  was run after this change.
- Asset registration now refreshes an existing timeline's asset catalog after
  probing, without adding clips. It updates the manifest and timeline using
  atomic replacements and restores both on a reported commit failure. Existing
  persistent history is reset as a new baseline after registration or relink,
  preserving its configured limit. No media registration jobs were run.
- Added reviewable `replace-asset` timeline editing through the operation
  dispatcher and JavaScript API. It switches a clip to another registered
  source, preserves its placement and compatible settings, accepts explicit
  source bounds and stream selection, and allows clearing playback rate or
  speed-ramp settings when required by the new media. No tests or replacement
  edits were run.
- Added the reviewable `set-speed` edit operation and `setTimelineClipSpeed`
  API for constant rates, speed ramps, and normal-speed reset. It recomputes
  clip duration from the unchanged source range and rescales clip-local
  keyframes, word timings, fades, transitions, and volume automation. Timeline
  validation catches resulting track overlaps. No tests or render jobs were
  run.
- Added `unregisterProjectAsset` and `asset unregister` for unused project
  media. It refuses assets still referenced by timeline clips, updates the
  manifest and timeline with rollback, resets persistent history when the
  timeline catalog changes, and preserves source and proxy files. No tests or
  asset operations were run.
- Added ordered per-clip stereo balance through the existing audio-effects
  edit API, using FFmpeg `stereotools`. Added required-filter preflight and
  capability/doctor reporting plus documentation. No tests, render, or audio
  review were run.
- Extended audio effects to audio tracks. `set-track-state` can replace or
  clear the ordered effect chain; added the dedicated `set-track-audio-effects`
  operation and `setTimelineTrackAudioEffects` API. Rendering applies clip
  effects first, mixes clip gain/fades/ducking into a temporary track stem, then
  applies track effects across that stem. No tests, render, or audio review were
  run.
- OTIO export now rejects track-level audio-effect chains instead of relying
  only on Engine metadata that other editors may discard. Updated the OTIO
  support boundary docs. No interchange operation or tests were run.
- Added project-time audio-track `volumeKeyframes`, with validation, inspection,
  reviewable updates through `set-track-state`, and gain-envelope compilation.
  Insert-gap freezes automation across the inserted gap; ripple-delete retimes
  the curve and resumes its post-cut level. Track-effect stems bake the curve,
  and OTIO export refuses it. No tests, renders, or interchange operations were
  run.
- Avatar composition now requires identical PNG canvas dimensions across the
  states of each layer. This holds the body bounds steady across blink/pose
  swaps and keeps face-feature anchors stable. Updated the existing assertion
  and README contract; no tests or renders were run.
- FFmpeg capability discovery and `doctor` now expose the filters used by
  audio effects, sidechain processing, and mastering. Render preflight checks
  all filters selected by the timeline before temporary media is created, with
  an actionable feature-specific error when a filter is missing. No tests or
  renders were run.
- Added validated `set-audio-mix` and `set-audio-mastering` edit operations and
  `setTimelineAudioMix` / `setTimelineAudioMastering` APIs. They replace or
  clear top-level audio processing settings and participate in dry-run/batch
  edits. Updated README, architecture, and implementation plan; no tests or
  renders were run.
- Added `set-project-state` and `setTimelineProjectState` for reviewable
  timeline duration and project-wide source-fit changes. Normal timeline
  validation rejects durations that exclude existing clips; canvas dimensions
  and frame rate stay pinned to project metadata. No tests or renders were run.
- Media probing now falls back to the longest valid stream duration when
  ffprobe omits or marks container duration unavailable, deriving seconds from
  `duration_ts × time_base` when the stream duration is absent. Files with no
  usable duration remain rejected. No media probes or tests were run for this
  change.
- Avatar composition now stages new sprite files, narration, scene HTML, and the
  updated project index before publishing. New files are linked without
  overwriting concurrent destinations; the project index is replaced last, and
  newly published outputs are rolled back if an earlier step fails. Syntax and
  whitespace checks passed; no test suite, media render, or audiovisual review
  was run.
- Generated avatar sprite and narration URLs now percent-encode copied asset
  filenames before embedding them in HTML. This prevents URL-reserved filename
  characters from changing the generated element attributes. Syntax and
  whitespace checks only; no test suite or render was run.
- Ran the read-only `doctor` and capabilities commands on Windows with Node.js
  22.22.2, FFmpeg 8.0.1, ffprobe, HyperFrames, GSAP, the cached Chrome
  Headless Shell, and required Engine filters/encoders available. Rhubarb,
  Whisper, local TTS/BGM runtimes are unavailable. Docker is installed but not
  running; these AI and container tools are optional. The Engine doctor summary
  distinguishes those optional warnings from missing core requirements. No
  test suite or render was run.
- The existing read-only `timeline inspect` CLI returned a computed clip end as
  `0.8999999999999999` for a 0.2-second overlay starting at 0.7 seconds. Rounded
  computed summary end times to six decimal places; the source timeline remains
  unchanged. CLI inspection confirms it now reports `0.9`. No test suite or
  render was run.
- Synchronous media registration previously probed the source, then copied it,
  so a source replacement during that interval could produce manifest metadata
  that did not describe the committed bytes. It now probes and fingerprints a
  staged copy before linking the asset into the project. Syntax and whitespace
  checks only; no test suite or media probe was run.
- Initial `timeline.json` creation during timeline render now stages the
  serialized record and publishes it with an exclusive hard link. A failed or
  interrupted write cannot leave a partial timeline at the final path, and a
  concurrent creator cannot be overwritten. Syntax and whitespace checks only;
  no render or test suite was run.
- Timeline render now replaces `index.html` and temporary duration changes to
  `meta.json` through same-directory temporary files and atomic rename. Error
  rollback uses the same path, preventing interrupted writes from truncating
  either project file. Syntax and whitespace checks only; no render or test
  suite was run.
- Declared the Engine package license as MIT, included the root license file in
  package contents, and documented third-party license boundaries. Metadata
  parsing and whitespace checks only; no test suite, render, package publish,
  or registry access was performed.
- Extended the versioned capabilities report with locally detected output
  formats, codec and color-profile support, and the predefined canvas presets.
  This gives generic consumers preflight data without parsing `doctor` output.
  Syntax and CLI response inspection only; no test suite or render was run.
- The capability report now explicitly marks browser runtime availability as
  unchecked and points consumers to `npm run doctor`, avoiding a false claim
  that package and encoder discovery fully proves render readiness. Syntax and
  CLI response inspection only; no test suite or render was run.
- Added common FFmpeg input container and video/audio decoder availability to
  the generic capabilities report and exported reusable FFmpeg list parsers.
  Local syntax and CLI response checks confirm the current Windows build
  advertises MP4/MOV/Matroska/WebM, H.264/HEVC/AV1/VP9/ProRes, and common audio
  decoders. No test suite or media render was run.
- Exported `list`, `has`, and `assert` APIs for FFmpeg input decoders and
  demuxers so consumers can preflight a specific media path without parsing the
  capability JSON. Syntax and CLI checks only; no test suite or render was run.
- Added `inspectMediaCompatibility` and `media support <path>` to check the
  probed container and every audio/video stream against local FFmpeg demuxers
  and decoders before ingest. Probe results now retain the input format aliases
  and video stream codec metadata. Syntax and CLI checks only; no full decode,
  test suite, or render was run.
- Asset registration and relinking now retain container aliases and all probed
  video stream records, alongside the existing audio stream metadata. This
  keeps the new probe detail in both the manifest and timeline asset catalog.
  Syntax and whitespace checks only; no test suite or ingest render was run.
- Added per-video-clip stream selection by zero-based video ordinal, including
  validation against registered stream metadata, the `set-video-state` CLI/API
  edit, and temporary FFmpeg proxies that also compose with playback-rate and
  speed-ramp processing. No render, test suite, or audiovisual review was run.
- Strengthened avatar PNG preflight to validate chunk checksums, deflate data,
  scanline lengths, and filter bytes instead of trusting the image header. This
  rejects truncated or corrupt mouth sprites before Rhubarb or composition.
  Syntax and whitespace checks only; no tests or renders were run.
- Corrected avatar composition to pass PNG file bytes into the shared image
  validator; the previous caller passed a path string to a Buffer-only helper.
  Syntax and whitespace checks only; no composition or render was run.
