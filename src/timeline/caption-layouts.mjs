const LAYOUTS = {
  subtitle: {
    x: 0.08, y: 0.76, width: 0.84, height: 0.16, fontSize: 54,
    fontWeight: 600, verticalAlign: 'bottom', paddingPixels: 12,
    textShadow: { color: '#000000b8', blurPixels: 4, offsetXPixels: 0, offsetYPixels: 2 },
    color: '#ffffff', backgroundColor: '#000000b8', textAlign: 'center',
  },
  social: {
    x: 0.08, y: 0.68, width: 0.84, height: 0.24, fontSize: 64,
    fontWeight: 800, lineHeight: 1.05, verticalAlign: 'bottom', paddingPixels: 14,
    textShadow: { color: '#000000cc', blurPixels: 6, offsetXPixels: 0, offsetYPixels: 3 },
    color: '#ffffff', backgroundColor: '#00000000', textAlign: 'center',
  },
  lowerThird: {
    x: 0.08, y: 0.72, width: 0.76, height: 0.18, fontSize: 48,
    fontWeight: 600, verticalAlign: 'bottom', paddingPixels: 12,
    textShadow: { color: '#000000b8', blurPixels: 3, offsetXPixels: 0, offsetYPixels: 2 },
    color: '#ffffff', backgroundColor: '#000000b8', textAlign: 'left',
  },
};

export const CAPTION_LAYOUT_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(LAYOUTS).map(([name, layout]) => [name, Object.freeze({
    ...layout,
    ...(layout.textOutline ? { textOutline: Object.freeze({ ...layout.textOutline }) } : {}),
    ...(layout.textShadow ? { textShadow: Object.freeze({ ...layout.textShadow }) } : {}),
  })]),
));

export function listCaptionLayoutPresets() {
  return Object.keys(CAPTION_LAYOUT_PRESETS);
}

export function resolveCaptionLayoutPreset(name = 'subtitle') {
  if (typeof name !== 'string' || !Object.hasOwn(CAPTION_LAYOUT_PRESETS, name)) {
    throw new TypeError(`Unknown caption layout preset: ${name}`);
  }
  return structuredClone(CAPTION_LAYOUT_PRESETS[name]);
}
