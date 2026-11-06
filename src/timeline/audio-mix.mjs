export function validateAudioMix(timeline) {
  const mix = timeline.audioMix;
  if (mix === undefined) return timeline;
  if (!mix || typeof mix !== 'object' || Array.isArray(mix) || (mix.ducking !== undefined && !Array.isArray(mix.ducking))
      || (mix.sidechain !== undefined && !Array.isArray(mix.sidechain))) {
    throw new TypeError('Timeline audioMix ducking and sidechain settings must be arrays when provided.');
  }
  const tracks = new Map(timeline.tracks.map((track) => [track.id, track]));
  for (const [index, rule] of (mix.ducking ?? []).entries()) {
    const source = tracks.get(rule?.sourceTrackId);
    const target = tracks.get(rule?.targetTrackId);
    if (!source || !target || source.kind !== 'audio' || target.kind !== 'audio' || source === target) throw new TypeError(`Audio ducking rule ${index + 1} must reference two different audio tracks.`);
    if (!Number.isFinite(rule.attenuation) || rule.attenuation < 0 || rule.attenuation > 1) throw new TypeError(`Audio ducking rule ${index + 1} attenuation must be between 0 and 1.`);
    for (const field of ['attackSeconds', 'releaseSeconds']) if (!Number.isFinite(rule[field] ?? 0) || (rule[field] ?? 0) < 0) throw new TypeError(`Audio ducking rule ${index + 1} ${field} must be non-negative.`);
  }
  for (const [index, rule] of (mix.sidechain ?? []).entries()) {
    const source = tracks.get(rule?.sourceTrackId);
    const target = tracks.get(rule?.targetTrackId);
    if (!source || !target || source.kind !== 'audio' || target.kind !== 'audio' || source === target
        || source.clips.length === 0 || target.clips.length === 0) {
      throw new TypeError(`Audio sidechain rule ${index + 1} must reference two different non-empty audio tracks.`);
    }
    const settings = resolveAudioSidechainSettings(rule);
    if (!Number.isFinite(settings.thresholdDb) || settings.thresholdDb < -60 || settings.thresholdDb > 0) throw new TypeError(`Audio sidechain rule ${index + 1} thresholdDb must be between -60 and 0.`);
    if (!Number.isFinite(settings.ratio) || settings.ratio < 1 || settings.ratio > 20) throw new TypeError(`Audio sidechain rule ${index + 1} ratio must be between 1 and 20.`);
    if (!Number.isFinite(settings.attackSeconds) || settings.attackSeconds < 0.00001 || settings.attackSeconds > 2) throw new TypeError(`Audio sidechain rule ${index + 1} attackSeconds must be between 0.00001 and 2.`);
    if (!Number.isFinite(settings.releaseSeconds) || settings.releaseSeconds < 0.00001 || settings.releaseSeconds > 9) throw new TypeError(`Audio sidechain rule ${index + 1} releaseSeconds must be between 0.00001 and 9.`);
    for (const field of Object.keys(rule)) {
      if (!['sourceTrackId', 'targetTrackId', 'thresholdDb', 'ratio', 'attackSeconds', 'releaseSeconds'].includes(field)) {
        throw new TypeError(`Audio sidechain rule ${index + 1} has an unsupported field: ${field}.`);
      }
    }
  }
  return timeline;
}

export function resolveAudioSidechainSettings(rule) {
  return {
    thresholdDb: rule.thresholdDb ?? -24,
    ratio: rule.ratio ?? 4,
    attackSeconds: rule.attackSeconds ?? 0.01,
    releaseSeconds: rule.releaseSeconds ?? 0.25,
  };
}

export function buildAudioVolumeAutomation(timeline, track, clip) {
  const start = clip.timelineStart;
  const end = start + clip.durationSeconds;
  const baseVolume = (clip.volume ?? 1) * (track.volume ?? 1);
  const duckRamps = [];
  for (const rule of timeline.audioMix?.ducking ?? []) {
    if (rule.targetTrackId !== track.id) continue;
    const source = timeline.tracks.find((item) => item.id === rule.sourceTrackId);
    for (const sourceClip of source.clips) {
      const duckStart = Math.max(start, sourceClip.timelineStart);
      const duckEnd = Math.min(end, sourceClip.timelineStart + sourceClip.durationSeconds);
      if (duckEnd <= duckStart) continue;
      duckRamps.push({
        start: duckStart,
        end: duckEnd,
        attenuation: rule.attenuation,
        attackSeconds: rule.attackSeconds ?? 0,
        releaseSeconds: rule.releaseSeconds ?? 0,
      });
    }
  }

  const points = new Set([start, end]);
  const fadeIn = clip.fadeInSeconds ?? 0;
  const fadeOut = clip.fadeOutSeconds ?? 0;
  if (fadeIn > 0) points.add(start + fadeIn);
  if (fadeOut > 0) points.add(end - fadeOut);
  for (const ramp of duckRamps) {
    points.add(Math.max(start, ramp.start - ramp.attackSeconds));
    points.add(ramp.start);
    points.add(ramp.end);
    points.add(Math.min(end, ramp.end + ramp.releaseSeconds));
  }

  return [...points].sort((a, b) => a - b).map((time) => {
    let volume = baseVolume;
    if (fadeIn > 0 && time < start + fadeIn) volume *= Math.max(0, (time - start) / fadeIn);
    if (fadeOut > 0 && time > end - fadeOut) volume *= Math.max(0, (end - time) / fadeOut);
    for (const ramp of duckRamps) volume *= duckFactorAt(time, ramp);
    return { time, volume: Number(volume.toFixed(6)) };
  });
}

function duckFactorAt(time, ramp) {
  if (time < ramp.start) {
    const attackStart = ramp.start - ramp.attackSeconds;
    if (ramp.attackSeconds === 0 || time <= attackStart) return 1;
    return 1 - ((time - attackStart) / ramp.attackSeconds) * (1 - ramp.attenuation);
  }
  if (time <= ramp.end || ramp.releaseSeconds === 0 || time >= ramp.end + ramp.releaseSeconds) return time <= ramp.end ? ramp.attenuation : 1;
  return ramp.attenuation + ((time - ramp.end) / ramp.releaseSeconds) * (1 - ramp.attenuation);
}
