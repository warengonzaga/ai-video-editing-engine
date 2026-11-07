/** Assign renderer layer indices while preserving track order and clip overlap. */
export function assignRenderTrackIndices(timeline) {
  const orderedTracks = [...timeline.tracks].sort((a, b) => a.order - b.order);
  const indices = new Map();
  let baseIndex = 0;
  for (const track of orderedTracks) {
    const laneEnds = [];
    const clips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id));
    for (const clip of clips) {
      let lane = laneEnds.findIndex((end) => end <= clip.timelineStart + 1e-6);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = clip.timelineStart + clip.durationSeconds;
      indices.set(`${track.id}/${clip.id}`, baseIndex + lane);
    }
    baseIndex += Math.max(1, laneEnds.length);
  }
  return indices;
}
