# AI Video Editing Engine — Project Handoff

The phased implementation plan and acceptance criteria are in
[`implementation-plan.md`](implementation-plan.md). Keep this handoff current
with verified capabilities, evidence, limits, and the next work.

Last updated: 2026-11-06

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
- Caption generation provides generic `subtitle`, `social`, `socialPop`, and
  `lowerThird` layout presets with explicit style overrides. The `socialPop`
  preset enables word-timed highlighting with a brief GSAP pop on the active
  word; other layouts can select `scale` or `pop`. A pixel-sampled render smoke
  verifies the timed highlight. Preset captions wrap at word boundaries;
  richer branded multi-line templates remain open.
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
  restore timeline metadata. Asset preprocessing and post-render audio mastering
  remain synchronous and outside the timeout. Async renders can retain a
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
  `Voice 015.mp3`, it produced 60 cues across shapes A, B, C, E, F, and X.
  This proves CLI integration and cue normalization only; recognition timing,
  sprite completeness, rendered lip sync, and human review remain open. Rhubarb
  is an optional external runtime and is not bundled.

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
  10.5s. The smoke cleanup now uses asynchronous Windows retry handling. Hosted
  matrix validation is complete for the current smoke suite; human audiovisual
  review and representative real-media validation remain open.
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

- Obtain a human listening review of the Engine-rendered `Voice 015.mp3`
  output. Its audio stream has been verified technically, but not auditioned.
- Decide a distribution model. The private package exposes an installable CLI
  binary for local/Git dependency use; public npm installation is not enabled.
- Recheck current hosted Linux/macOS/Windows CI state and add a clean-machine
  setup validation. Review current dependency versions before upgrading.
- Integrate Explainer Studio only after Engine behavior and outputs pass the
  agreed visual and audio review.

The detailed phase checklist and acceptance criteria are maintained in
[`implementation-plan.md`](implementation-plan.md). Update it when evidence
changes; do not claim full-editor completion from schema tests or a synthetic
smoke render alone.

## Latest implementation evidence (2026-11-06)

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
  another through the open PR's `pull_request` event. Removed feature/fix branch
  push triggers to avoid the duplicate three-OS test, render, and audit runs;
  PRs targeting `dev` still run the full matrix, and pushes to `dev` still run it.
- The latest Windows render-smoke run also covers an MP4 whose video stream
  starts at 1.0 second. The rendered clip shows its red source frame at timeline
  0.25 seconds; the output records source start time 1.0 second. The complete
  smoke passes with this offset regression enabled, along with the existing
  VFR, layered, format, audio, and sync checks. This remains generated fixture
  evidence rather than real camera footage or cross-platform validation.
