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
Transcription requires a supported provider or local model/runtime; importing an
existing SRT, VTT, or JSON transcript does not.
Consumers can check the same environment programmatically with
`getEngineCapabilities()` or print its versioned JSON contract from the CLI:

```sh
node src/cli.mjs capabilities
```

The report includes required tool availability, common FFmpeg output encoders,
and optional filters used by specific render features.

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
supply a dialog file when available to help recognition. Rhubarb returns shape
states `a`–`f` and `x` by default; avatar layers need matching sprite states
before rendering. Add `g` or `h` assets only when enabling those extended shapes.
See the [Rhubarb usage guide](https://github.com/DanielSWolf/rhubarb-lip-sync)
and [license](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/LICENSE.md).

```sh
node src/cli.mjs lip-sync Voice.mp3 mouth-cues.json lip-sync-options.json
```

```json
{
  "rhubarb": "rhubarb",
  "recognizer": "phonetic",
  "extendedShapes": "X",
  "dialogFile": "script.txt"
}
```

The JavaScript API exports `rhubarbLipSyncCues(audioPath, options)`. This
produces timing and mouth labels; it does not generate avatar art or guarantee
viseme recognition accuracy.

For sprite avatars, `createAvatarComposition(projectPath, spec)` accepts
consumer-supplied image layers and state cue tracks. Each layer's default image
is restored when a timed cue ends, so sparse blink or expression cues return to
the default state. Use `audioLevelCues` for a rough audio-reactive mouth demo or
map cues from a speech recognizer onto the sprite states your asset pack has.
The Engine does not bundle avatar artwork or claim phoneme-accurate lip sync.

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
existing project folders are never overwritten.

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
to bound the HyperFrames render plus any final FFmpeg encode (1–86400 seconds).
Timed-out renders terminate their process tree and remove temporary output.
The JavaScript async APIs `renderProjectAsync`, `renderTimelineAsync`, and
`renderEditedProjectAsync` also accept an `AbortSignal` as `signal`. CLI renders
handle Ctrl+C by cancelling the active render. Timeline asset preprocessing
and post-render audio mastering are synchronous and are outside the timeout.
The synchronous `renderProject` and `renderTimeline` APIs remain available
without cancellation. To render PNG frames, set
`{ "format": "png-sequence" }`; the output path is a new directory. Defaults
remain controlled by HyperFrames quality (`draft`, `standard`, or `high`).
Set `"colorProfile": "rec709"` or `"colorProfile": "rec2020-sdr"` to convert
the rendered SDR video from the renderer's BT.709 working output and write
matching color metadata. This requires the FFmpeg `colorspace` filter and
performs a final video encode. HDR profiles are not supported. `npm run doctor`
reports whether the filter is available. `npm run doctor` also lists common
H.264, H.265, VP9, and ProRes encoder availability. Before rendering, the
Engine checks that FFmpeg provides the requested final encoder and reports a
setup error before starting browser capture when it is missing.

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

`asset verify` checks registered source and proxy SHA-256 identities against
the manifest and reports missing or modified files. `asset relink` replaces
the media for an existing asset ID, refreshes its probe metadata and
fingerprint, and keeps
the project-relative path stable so existing timeline references continue to
work. If `timeline.json` exists, its asset metadata and source fingerprint are
refreshed as well; the timeline is revalidated before the replacement is saved.
Stale proxies are removed when the source fingerprint changes. Relinking only
accepts the original media type and extension, and preserves the replacement
source file.

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
requested.

`asset preview` creates cached thumbnails and/or an audio waveform for a
registered asset. It returns source-relative thumbnail timestamps and paths,
plus min/max waveform samples that preview clients can draw at any zoom level.
Preview files live under `assets/previews/` and are keyed by the source hash and
generation settings; changed source media cannot silently reuse stale previews.
Pass an options JSON file to override `thumbnailIntervalSeconds` (default 2,
0.25–60), `thumbnailMaxDimension` (default 320, 80–1280), or `waveformPoints`
(default 2000, 32–20000). The JavaScript API is
`await generateAssetPreview(projectPath, assetId, options)`.

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
JavaScript API (`timelineFromEdl`, `editTimeline`, `editTimelineBatch`,
`detachAudioFromTimelineClip`, `createTimelineHistory`, `createCaptionTrack`,
and `renderTimeline`).

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
separately through the consumer's normal persistence flow.

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
timeline operations.

Set a constant `playbackRate` from `0.1` to `5` on video or audio clips. The
source range must equal `durationSeconds * playbackRate`. Rendering creates a
temporary FFmpeg proxy for the selected source range (video is re-encoded;
audio uses pitch-preserving `atempo`) and removes it afterward. Original assets
and the saved timeline remain unchanged.

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
`sourceOut - sourceIn`.
Rates must stay between 0.1× and 5×. Use the exported `speedRampDuration`
helper to compute the required clip duration. The video proxy maps frame
timestamps through the curve. Audio uses pitch-preserving FFmpeg `rubberband`
commands sampled at up to 50 ms source intervals, then pads or trims to the
clip's exact timeline duration. Audio speed ramps require an FFmpeg build with
the `rubberband` filter; the renderer reports a clear error when it is missing.
The `doctor` command reports whether the filter is available. Trim and split
operations rebase speed curves and visual keyframes at the edit point.

Audio tracks and clips accept `volume` from 0 to 1, and audio clips accept
`fadeInSeconds` and `fadeOutSeconds`. To duck a music track while narration clips
are active, add this to the timeline:

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
is checked before the mastered render replaces its input.

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
and do not embed media. The initial profile supports video/audio tracks, cuts,
and gaps. It rejects overlaps, retiming, transitions, nested compositions,
and remote media references. Engine-only clip settings and overlay tracks are
retained in OTIO metadata for Engine round trips, but other editors may ignore
or remove that metadata.
