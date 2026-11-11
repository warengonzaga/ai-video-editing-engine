const BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

export function validateBlendMode(clip, trackKind) {
  if (clip.blendMode === undefined) return;
  if (trackKind !== 'video' && trackKind !== 'overlay') {
    throw new TypeError(`Clip ${clip.id} blendMode is supported only on video and overlay tracks.`);
  }
  if (typeof clip.blendMode !== 'string' || !BLEND_MODES.has(clip.blendMode)) {
    throw new TypeError(`Clip ${clip.id} blendMode must be one of: ${[...BLEND_MODES].join(', ')}.`);
  }
}

export function blendModeStyle(clip) {
  return clip.blendMode && clip.blendMode !== 'normal' ? `mix-blend-mode:${clip.blendMode};` : '';
}
