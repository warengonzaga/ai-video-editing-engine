/** Return a render-only timeline with hidden visual and muted audio tracks removed. */
export function timelineForRender(timeline) {
  const tracks = timeline.tracks.filter((track) => (track.kind === 'audio' ? track.muted !== true : track.visible !== false));
  const activeTrackIds = new Set(tracks.map((track) => track.id));
  const audioMix = timeline.audioMix === undefined ? undefined : {
    ...timeline.audioMix,
    ...(timeline.audioMix.ducking !== undefined
      ? { ducking: timeline.audioMix.ducking.filter((rule) => activeTrackIds.has(rule.sourceTrackId) && activeTrackIds.has(rule.targetTrackId)) }
      : {}),
    ...(timeline.audioMix.sidechain !== undefined
      ? { sidechain: timeline.audioMix.sidechain.filter((rule) => activeTrackIds.has(rule.sourceTrackId) && activeTrackIds.has(rule.targetTrackId)) }
      : {}),
  };
  return { ...timeline, tracks, ...(audioMix === undefined ? {} : { audioMix }) };
}
