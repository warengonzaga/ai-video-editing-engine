# Avatar Mouth Pack Authoring

This guide defines the mouth artwork expected by the Engine's Rhubarb-backed
speech animation. The Engine produces timed shape changes and validates the
sprite files; it does not draw mouth artwork or guarantee that an audio
recognizer selected the correct shape.

## Required shapes

Phonetic avatar composition requires a distinct image for each A-H shape and
the X rest shape. The Engine's default Rhubarb configuration requests `GHX`, so
the complete pack is required even when a particular recording does not use
every shape.

| Shape | Articulation to draw | Typical sound | Animation role |
| --- | --- | --- | --- |
| A | Lips closed with gentle pressure | P, B, M | Bilabial closure |
| B | Slightly open, teeth close together | K, S, T, EE | Consonants and narrow vowels |
| C | Medium-open mouth | EH, AE | Open vowel; in-between from A/B toward D |
| D | Widest jaw opening | AA | Wide-open vowel |
| E | Slightly rounded; no wider than C | AO, ER | Rounded vowel; in-between from C/D toward F |
| F | Strongly puckered lips | UW, OW, W | Rounded or puckered vowel |
| G | Upper teeth touch the lower lip | F, V | Labiodental consonant |
| H | Raised tongue behind upper teeth; medium-open jaw | Long L | Tongue articulation; visibility depends on the art style |
| X | Closed, relaxed lips | Silence or pauses | Idle/rest position |

These are broad viseme groups, not one mouth shape per alphabetic vowel. In
particular, C and E are useful transition drawings: make A-C-D, B-C-D, C-E-F,
and D-E-F read smoothly when the art changes by replacement. The Engine does
not crossfade sprite images to synthesize intermediate mouth positions.

## Keep the pack visually consistent

- Draw all states for the same avatar, head angle, camera scale, and lighting.
- Keep one fixed layer position and size for every mouth state. Align the
  upper-lip center and mouth centerline to the same normalized canvas coordinates
  in every image; the Engine does not automatically realign artwork within a
  sprite.
- Keep the upper lip anchored as the jaw opens. Extend wider-open jaw shapes
  downward instead of shifting the whole mouth up or sideways. Keep the face and
  glasses front-facing; show pointing direction through the eyes or pose layer.
- Preserve the same outline weight, lip/skin palette, shading, and tooth style
  across every state. If a style does not normally expose teeth, keep teeth
  exposure consistent with that character's design rather than adding a new
  rendering style to only one shape.
- Keep the X rest mouth closed and relaxed. A may look nearly identical, but
  should show subtle lip pressure where the design supports it.
- Export each state as a valid PNG on the same canvas dimensions and with
  transparent surroundings. Do not crop each mouth state to its own bounds.
- Give each required state distinct image content. Different filenames alone do
  not make the artwork distinct.

## Keep blinking isolated

Use a dedicated `eyes` layer for blink states and keep the body sprite unchanged
while the avatar blinks. Replacing a full-body PNG to close the eyes can make
the hair, glasses, face, clothing, or silhouette flicker even when all states
share the same canvas dimensions. For body pose changes, preserve the canvas,
framing, scale, and body anchor across states.

Matching canvas sizes keeps the sprite layer fixed, but it cannot prove that
mouth pixels share a common anchor or art style. Review the pack as a contact
sheet and watch a rendered sequence before treating it as production-ready.

## Preflight and cue generation

Use the validator before composing the avatar. It resolves image paths relative
to the JSON file and reports the shape mapping and shared canvas size:

```sh
node src/cli.mjs avatar validate-mouth-pack mouth-pack.json
```

The validator rejects missing states, repeated mappings, malformed PNGs,
mismatched canvas dimensions, and byte-identical images. These checks do not
measure perceptual similarity, anchor alignment, or whether each drawing
actually matches its intended articulation. Its result includes
`visualReviewRequired: true` and a machine-readable checklist for those
artwork and cue-alignment checks. Structural validity alone does not approve the
pack for use.

For better recognition, provide the spoken dialog when it is known. Pass it as
`dialogText` from an in-memory workflow, or use `dialogFile` when the text
already exists on disk. Inline text is staged temporarily and removed after
cue generation. Use the Engine's default `phonetic` recognizer for multilingual
recordings; use `pocketSphinx` only for English recordings. Always compare
generated cues with the audio and correct them when necessary.

The definitions follow [Rhubarb Lip Sync's mouth-shape guide](https://github.com/DanielSWolf/rhubarb-lip-sync#mouth-shapes)
and its [recognizer and dialog-file guidance](https://github.com/DanielSWolf/rhubarb-lip-sync#recognizers).
