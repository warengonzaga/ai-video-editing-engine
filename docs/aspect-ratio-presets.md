# Social Video Aspect-Ratio Presets

This document defines the platform-informed aspect-ratio presets exposed by
the AI Video Editing Engine. The engine remains general-purpose: presets are
convenience defaults, and callers can continue to use arbitrary dimensions.

## Initial preset baseline

| Preset | Ratio | Default dimensions | Common destinations |
| --- | --- | --- | --- |
| `vertical` | 9:16 | 1080 × 1920 | TikTok, Instagram/Facebook Reels and Stories, YouTube Shorts |
| `portrait-feed` | 4:5 | 1080 × 1350 | Instagram feed, LinkedIn vertical feed video |
| `square` | 1:1 | 1080 × 1080 | TikTok, Instagram/LinkedIn feed placements |
| `landscape` | 16:9 | 1920 × 1080 | YouTube standard video, LinkedIn landscape feed video |

The ratio is the platform-oriented choice; the pixel dimensions are practical
HD defaults, not a promise that every platform requires those exact pixels.
Where a platform publishes a lower or different maximum, export dimensions can
be lowered while preserving the selected ratio. Keep dimensions configurable.

The JavaScript API exports `CANVAS_PRESETS`, `listCanvasPresets()`, and
`resolveCanvasPreset(id)` from the package entry point. The CLI exposes the same
catalog with `node src/cli.mjs presets list`; create projects with
`node src/cli.mjs project create <slug> --preset <id> [fps] [durationSeconds]`.
The selected identifier is stored as `canvasPreset` beside the resolved
`width` and `height` in `meta.json`. Existing custom-dimension project creation
remains supported.

## Selection guidance

- Recommend `vertical` for full-screen short-form video. YouTube identifies
  Shorts as vertical; TikTok recommends 9:16 and lists 16:9 and 1:1 as other
  supported ad shapes.
- Recommend `portrait-feed` for tall feed placements where a full-screen 9:16
  canvas is not wanted. LinkedIn explicitly recommends 4:5 vertical video and
  allows up to 1080 × 1350 pixels.
- Recommend `square` for flexible feed distribution. TikTok and LinkedIn list
  1:1 as a supported video shape.
- Recommend `landscape` for conventional long-form video and landscape feeds.
  YouTube's standard desktop player ratio is 16:9, with 1920 × 1080 listed as
  its 1080p resolution.
- Keep 4:3 and other ratios available through custom width/height settings;
  this initial preset list does not restrict the renderer.

## Rendering behavior

Choosing a preset sets the output canvas only. Source-to-canvas behavior is a
separate policy with these options:

- `contain` scales the full source frame inside the clip bounds, leaving empty
  canvas around it when the aspect ratios differ. This is the default because
  it preserves the full source image.
- `cover` fills the clip bounds and center-crops any overflow.
- `fill` stretches the source to the clip bounds and can distort its shape.

Set `sourceFit` on project metadata or `timeline.project` for the project-wide
default; a video clip's `fit` field overrides that policy. The CLI accepts
`--fit contain|cover|fill` during project creation. The renderer validates these
values rather than silently substituting a crop mode. Platform safe-area guides
are separate and are not implied by a ratio preset.

## Sources

- [YouTube: Video resolution and aspect ratios](https://support.google.com/youtube/answer/6375112)
- [YouTube: Shorts upload tips](https://support.google.com/youtube/answer/12921536)
- [TikTok Business Help: Reservation in-feed ad specifications](https://ads.tiktok.com/resources/help/article/tiktok-reservation-in-feed-ads-reach-frequency)
- [LinkedIn Help: Video ads advertising specifications](https://www.linkedin.com/help/linkedin/answer/a424737)
- [Vimeo Help: Instagram video aspect-ratio options](https://help.vimeo.com/hc/en-us/articles/12426476775953-How-to-select-a-ratio-in-the-video-editor-for-Instagram-posts)

Platform specifications can change and may differ between organic uploads,
advertising placements, and publishing tools. Recheck the destination's current
requirements before adding validation that rejects an export.
