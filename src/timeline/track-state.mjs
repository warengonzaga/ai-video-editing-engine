/** Return a render-only timeline with hidden tracks and disabled clips removed. */
export function timelineForRender(timeline) {
  const soloedAudio = new Set(timeline.tracks
    .filter((track) => track.kind === 'audio' && track.solo === true)
    .map((track) => track.id));
  const tracks = timeline.tracks
    .filter((track) => (track.kind === 'audio'
      ? track.muted !== true && (soloedAudio.size === 0 || soloedAudio.has(track.id))
      : track.visible !== false))
    .map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.enabled !== false) }));
  const activeTrackIds = new Set(tracks.filter((track) => track.clips.length > 0).map((track) => track.id));
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
