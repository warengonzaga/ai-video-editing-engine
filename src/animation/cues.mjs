/** Validate a provider-neutral track of timed animation states. Times are seconds. */
export function validateAnimationCues(track) {
  if (!track || track.schemaVersion !== 1 || !Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0 || !Array.isArray(track.cues)) {
    throw new TypeError('Animation track requires schemaVersion 1, a positive durationSeconds, and cues.');
  }
  let previousEnd = 0;
  for (const cue of track.cues) {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd || cue.end <= cue.start || cue.end > track.durationSeconds || typeof cue.state !== 'string' || !cue.state.trim()) {
      throw new TypeError('Animation cues must have a non-empty state and ordered, non-overlapping times within the track duration.');
    }
    previousEnd = cue.end;
  }
  return track;
}

/** Return the active state at time, or fallback in gaps and at the end. */
export function animationStateAt(track, time, fallback = null) {
  validateAnimationCues(track);
  if (!Number.isFinite(time) || time < 0 || time > track.durationSeconds) throw new RangeError('Time must be within the track duration.');
  return track.cues.find((cue) => cue.start <= time && time < cue.end)?.state ?? fallback;
}
