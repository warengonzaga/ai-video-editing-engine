const presets = [
  {
    id: 'vertical',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    platforms: ['TikTok', 'Instagram Reels and Stories', 'Facebook Reels and Stories', 'YouTube Shorts'],
  },
  {
    id: 'portrait-feed',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    platforms: ['Instagram feed', 'LinkedIn feed'],
  },
  {
    id: 'square',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    platforms: ['TikTok', 'Instagram feed', 'LinkedIn feed'],
  },
  {
    id: 'landscape',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    platforms: ['YouTube', 'LinkedIn feed'],
  },
].map((preset) => Object.freeze({ ...preset, platforms: Object.freeze(preset.platforms) }));

export const CANVAS_PRESETS = Object.freeze(presets);

export function listCanvasPresets() {
  return CANVAS_PRESETS;
}

export function resolveCanvasPreset(id) {
  const preset = CANVAS_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) {
    throw new TypeError(
      `Unknown canvas preset "${id}". Available presets: ${CANVAS_PRESETS.map(({ id: name }) => name).join(', ')}.`,
    );
  }
  return preset;
}
