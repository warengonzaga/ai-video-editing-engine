# Explainer Studio to Engine Migration Handoff

This document defines the boundary for moving talking-avatar production from
Explainer Studio to the generic AI Video Editing Engine. Studio owns explainer
decisions and avatar assets. Engine owns validated media timelines, editing,
animation, audio, and rendering.

## Current migration status

- Studio currently renders frames in Python/Pillow and derives five mouth states
  (`rest`, `closed`, `small`, `open`, `wide`) from audio loudness.
- The Studio Waren pack has four poses, optional pose-specific blink images,
  transparent mouth patches, and a normalized mouth anchor with optional
  per-pose fitting.
- Engine currently has a separate optional avatar composer and Rhubarb adapter.
  Its phonetic composition requires distinct A-H and X/rest states, full-canvas
  sprite layers, and Engine-specific placement fields. This does not match
  Studio's five-state mouth patch manifest.
- Studio has not yet rendered Voice 015 through the generic Engine timeline.
  The migration acceptance gate is therefore unmet. Keep all Engine avatar
  code, commands, capability metadata, docs, and tests available until that gate
  passes.
- The existing Studio demo and Engine avatar render projects remain untouched
  and available for comparison.

## Migration ownership

| Capability | Owner after migration |
| --- | --- |
| Explainer setup, script/storyboard review, template and scene decisions | Studio |
| Avatar generation, pose selection, blink scheduling, mouth artwork and fitting | Studio |
| Voice selection, speech-to-viseme cue generation, cue-to-art mapping, avatar preview and human review | Studio |
| Timeline schema, image/video/audio clip validation, generic layers and keyframes, transitions, audio processing, render formats and rendering | Engine |

Studio must preserve user narration and renders, present the script/storyboard
review gates in chat, and keep the existing preview/comparison workflow.

## Existing generic timeline is sufficient

The current timeline supports this composition without adding avatar-specific
Engine behavior:

- Put the fixed presenter body on a video track as a full-duration image clip.
- Put each transparent, full-canvas eye state on a separate video track. Use
  sequential clips for open/blink states, or a static open-eye layer plus timed
  blink overlays when the blink image is authored as an overlay.
- Put each transparent, full-canvas mouth state on another video track. Studio
  converts its timed speech cues into image clips using shared placement and
  duration boundaries; the cue state names remain Studio-owned.
- Put the selected narration on an audio track at timeline zero.
- Use ordinary clip placement/keyframes for other reusable visual movement.

Separate video tracks preserve z-order; PNG transparency preserves alignment;
clip start/duration carries timing. This also supports animated logos, UI
states, character parts, and other sprite-based graphics. The Engine timeline
must not gain avatar, eye, mouth, Rhubarb, or character-specific fields for this
workflow.

### Studio-generated Engine input

Studio should create a normal Engine project, register its rendered layer PNGs
and narration, write a validated timeline JSON, then invoke the Engine CLI:

```powershell
node <engine>/src/cli.mjs project create explainer-draft 1920x1080 30 11.133333 --background-color '#f3f0eb'
node <engine>/src/cli.mjs asset register-many <project> <body.png> <eyes-open.png> <eyes-blink.png> <mouth-rest.png> <mouth-a.png> <narration.mp3>
node <engine>/src/cli.mjs timeline validate <project>/timeline.json
node <engine>/src/cli.mjs timeline render <project> <timeline.json> <new-preview.mp4> draft
```

Project creation already writes an initial `timeline.json`; asset registration
updates its asset catalog. Studio reads that file, adds its ordered tracks and
timed image/audio clips, then validates and renders the resulting timeline.

The registered assets are referenced by project-relative paths and IDs in the
timeline. For image clips, Studio uses `sourceIn: 0`, `sourceOut` equal to clip
duration, a shared canvas placement (normally `x: 0, y: 0, width: 1, height:
1` for full-canvas transparent layers), and its own cue intervals. A fixed body
clip spans the scene; state clips occupy their cue intervals on ordered tracks;
the narration clip spans its source duration on an audio track. Studio should
use the normal timeline contract and `timeline render`, not `avatar-compose`.

The relevant part of the timeline can look like this; Studio supplies all asset
records and every state interval from its own avatar/cue pipeline:

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "explainer-draft",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "durationSeconds": 11.133333,
    "backgroundColor": "#f3f0eb"
  },
  "assets": [
    { "id": "body", "path": "assets/body.png", "type": "image" },
    { "id": "eyes-open", "path": "assets/eyes-open.png", "type": "image" },
    { "id": "eyes-blink", "path": "assets/eyes-blink.png", "type": "image" },
    { "id": "mouth-rest", "path": "assets/mouth-rest.png", "type": "image" },
    { "id": "mouth-small", "path": "assets/mouth-small.png", "type": "image" },
    { "id": "narration", "path": "assets/narration.mp3", "type": "audio", "durationSeconds": 11.114667 }
  ],
  "tracks": [
    {
      "id": "body", "kind": "video", "order": 0, "clips": [
        { "id": "body-full", "assetId": "body", "sourceIn": 0, "sourceOut": 11.133333, "timelineStart": 0, "durationSeconds": 11.133333, "x": 0, "y": 0, "width": 1, "height": 1 }
      ]
    },
    {
      "id": "eyes", "kind": "video", "order": 1, "clips": [
        { "id": "eyes-open-before", "assetId": "eyes-open", "sourceIn": 0, "sourceOut": 1.8, "timelineStart": 0, "durationSeconds": 1.8, "x": 0, "y": 0, "width": 1, "height": 1 },
        { "id": "eyes-blink-1", "assetId": "eyes-blink", "sourceIn": 0, "sourceOut": 0.14, "timelineStart": 1.8, "durationSeconds": 0.14, "x": 0, "y": 0, "width": 1, "height": 1 },
        { "id": "eyes-open-after", "assetId": "eyes-open", "sourceIn": 0, "sourceOut": 9.193333, "timelineStart": 1.94, "durationSeconds": 9.193333, "x": 0, "y": 0, "width": 1, "height": 1 }
      ]
    },
    {
      "id": "mouth", "kind": "video", "order": 2, "clips": [
        { "id": "mouth-state-1", "assetId": "mouth-small", "sourceIn": 0, "sourceOut": 0.18, "timelineStart": 0, "durationSeconds": 0.18, "x": 0, "y": 0, "width": 1, "height": 1 },
        { "id": "mouth-state-2", "assetId": "mouth-rest", "sourceIn": 0, "sourceOut": 0.12, "timelineStart": 0.18, "durationSeconds": 0.12, "x": 0, "y": 0, "width": 1, "height": 1 }
      ]
    },
    {
      "id": "narration", "kind": "audio", "order": 3, "clips": [
        { "id": "voice", "assetId": "narration", "sourceIn": 0, "sourceOut": 11.114667, "timelineStart": 0, "durationSeconds": 11.114667 }
      ]
    }
  ]
}
```

The abbreviated eye and state clips above illustrate the contract; they are
not a complete cue track and must be extended by Studio to the scene duration.

`asset register-many` copies each input into the project. Studio must register
only assets prepared for that project and must write new project/output paths;
it must not overwrite the user's source narration, prior renders, or existing
Engine artifacts.

## Compatibility work Studio must own

1. Replace the Pillow talking-avatar render path with scene/avatar composition
   that emits generic Engine timeline JSON and calls the Engine CLI.
2. Keep pose selection, eye blinks, pose-specific mouth positioning, borderless
   mouth artwork, and the five-state Waren pack in Studio. Its existing
   `mouth_anchor`/`mouth_fit` schema stays Studio-owned.
3. Add phonetic cue generation in Studio and define how its cue states map to
   the available art. The existing five-state pack cannot satisfy Engine's
   A-H-plus-X distinct-state rule. Either generate/review the required artwork
   for the selected cue contract or explicitly define a Studio-owned mapping
   that preserves useful phonetic distinctions; do not weaken Engine rules to
   fit this pack.
4. Keep the contact sheet and visual review before render, and preserve the
   approved script/storyboard gates. Render audio remains the selected source
   narration and must be checked against that source.
5. Preserve the current Studio demo and existing renders for side-by-side
   comparison during migration.

## Migration acceptance gate

Do not retire Engine avatar code until all are true:

- Studio renders the existing Voice 015 sample through the generic Engine CLI
  and timeline, with synchronized narration and expected output dimensions,
  frame rate, and duration.
- The Studio-produced timeline preserves eye blinking and phonetic mouth cue
  timing without invoking Engine's avatar-specific composer or Rhubarb adapter.
- Visual and audio review confirms the avatar remains aligned/stable, mouth
  art looks acceptable, blinks do not resize/flicker the body, and audio is
  present and synchronized.
- The original Studio demo remains renderable for comparison.

The generic Engine timeline proof is not a substitute for this Studio migration
gate or its human review.

## Engine cleanup after Studio passes

After Studio's gate passes, use a separate short-lived feature branch from
`dev`, move required behavior/tests/docs to Studio first, and then retire from
Engine:

- `avatar-compose`, `avatar validate-mouth-pack`, `lip-sync`, and the
  mouth-specific `audio-cues` CLI/API surfaces;
- `src/animation/avatar.mjs`, the Rhubarb-specific adapter and avatar-only PNG
  validation if no remaining generic caller needs them;
- avatar/Rhubarb capability metadata and the optional Rhubarb doctor check;
- avatar-specific public exports, docs, package file entries, and tests.

Keep provider-neutral animation-cue utilities only if a non-avatar Engine
feature uses them. Keep generic image probing/validation only where the Engine's
media registration or rendering contract needs it. Before removing shared code,
search every import/export/caller and check actual package consumers. If the
package has been published, follow its compatibility/versioning policy before
removing public surfaces.

### Current Engine callers and surfaces

| Location | Avatar-specific responsibility and callers | Cleanup action after gate |
| --- | --- | --- |
| `src/animation/avatar.mjs` | `createAvatarComposition[Async]`; validates avatar layers, parent-relative placement and blink roles, stages sprites/narration, emits an avatar HTML/GSAP composition; called by CLI and exported from `src/index.mjs` | Move composer and required tests/guidance to Studio, then remove Engine copy |
| `src/animation/rhubarb.mjs` | External Rhubarb invocation, audio conversion, cue normalization/mapping, strict A-H/X sprite rules; called by avatar composer, CLI, and capability discovery; exported publicly | Move Studio-required adapter/policy to Studio before removal |
| `src/animation/png-image.mjs` | `pngDimensions`; currently used only for avatar sprite validation by avatar/Rhubarb modules | Move only if Studio needs strict sprite PNG inspection; otherwise remove after caller search |
| `src/animation/cues.mjs` | Generic cue validation/state lookup; current callers are avatar/Rhubarb only and it is publicly exported | Keep only if another non-avatar Engine feature adopts it; otherwise move/remove |
| `src/animation/audio-cues.mjs` | `audioLevelCues` emits mouth-named amplitude states; CLI `audio-cues` and public API export | Move to Studio or remove; do not retain a mouth-specific engine helper |
| `src/capabilities.mjs`, `src/doctor.mjs` | Avatar/Rhubarb runtime metadata, mouth contract and optional Rhubarb check | Remove avatar metadata and Rhubarb readiness only after Studio replaces them |
| `src/cli.mjs`, `src/index.mjs` | `avatar-compose`, `avatar validate-mouth-pack`, `lip-sync`, `audio-cues`; public exports for avatar/Rhubarb/cue helpers | Remove after Studio owns caller behavior; preserve generic timeline/media CLI and API |
| `test/avatar-composition.test.mjs`, `test/animation-cues.test.mjs`, `test/capabilities.test.mjs` | Cover avatar composition, cue/Rhubarb behavior, and capability metadata | Move relevant assertions/tests to Studio or delete with retired code |
| `README.md`, `docs/usage.md`, `docs/avatar-mouth-packs.md`, `docs/architecture.md`, `docs/implementation-plan.md`, `docs/handoff.md`, `package.json` | Describe or package the optional avatar workflow | Update public description and package file list after removal; preserve the generic Engine timeline documentation |

Shared runtime dependencies such as Node.js, FFmpeg/ffprobe, GSAP, and
HyperFrames remain Engine-owned. `pngDimensions` is not currently the generic
asset registration image probe, so removing that helper does not imply removing
the Engine's normal image registration support.

## Evidence recorded for this handoff

- `src/timeline/validate.mjs` accepts image assets on ordered video tracks,
  separate tracks for overlapping layers, clip timing, placement, and visual
  keyframes.
- `src/timeline/render.mjs` renders image assets as still-image clips and
  renders audio clips on audio tracks.
- `src/timeline/render.mjs` plus the existing `timeline render` CLI uses the
  same generic renderer for all timeline tracks.
- Avatar-specific behavior is isolated behind `src/animation/avatar.mjs`,
  `src/animation/rhubarb.mjs`, CLI dispatch in `src/cli.mjs`, metadata in
  `src/capabilities.mjs`, and the optional doctor entry in `src/doctor.mjs`.
- `src/animation/cues.mjs` is consumed by avatar/Rhubarb code only today.
  `src/animation/png-image.mjs` is used for sprite validation, not generic
  timeline media registration. Recheck all references at cleanup time.
