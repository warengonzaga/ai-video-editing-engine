const SOCIAL_LAYOUT = {
  x: 0.08, y: 0.68, width: 0.84, height: 0.24, fontSize: 64,
  fontWeight: 800, lineHeight: 1.05, verticalAlign: 'bottom', paddingPixels: 14,
  wordWrap: true,
  textShadow: { color: '#000000cc', blurPixels: 6, offsetXPixels: 0, offsetYPixels: 3 },
  color: '#ffffff', backgroundColor: '#00000000', textAlign: 'center',
};

const LAYOUTS = {
  subtitle: {
    x: 0.08, y: 0.76, width: 0.84, height: 0.16, fontSize: 54,
    fontWeight: 600, verticalAlign: 'bottom', paddingPixels: 12, wordWrap: true,
    textShadow: { color: '#000000b8', blurPixels: 4, offsetXPixels: 0, offsetYPixels: 2 },
    color: '#ffffff', backgroundColor: '#000000b8', textAlign: 'center',
  },
  social: SOCIAL_LAYOUT,
  socialPop: {
    ...SOCIAL_LAYOUT,
    wordHighlight: true, wordHighlightColor: '#ffe45c', wordHighlightAnimation: 'pop',
  },
  socialStack: {
    ...SOCIAL_LAYOUT,
    y: 0.64, height: 0.3, fontSize: 58, lineHeight: 1.02,
    wordsPerCaption: 6, wordsPerLine: 3,
    wordHighlight: true, wordHighlightColor: '#ffe45c', wordHighlightAnimation: 'pop',
  },
  lowerThird: {
    x: 0.08, y: 0.72, width: 0.76, height: 0.18, fontSize: 48,
    fontWeight: 600, verticalAlign: 'bottom', paddingPixels: 12, wordWrap: true,
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
