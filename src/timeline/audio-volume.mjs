export function validateAudioVolumeKeyframes(keyframes, clip) {
  if (keyframes === undefined) return;
  if (!Array.isArray(keyframes) || keyframes.length === 0 || keyframes.length > 512) {
    throw new TypeError(`Clip ${clip.id} volumeKeyframes must be an array with 1 to 512 entries.`);
  }
  if (keyframes[0]?.time !== 0) throw new TypeError(`Clip ${clip.id} volumeKeyframes must start at time 0.`);
  let previousTime = -1;
  for (const [index, keyframe] of keyframes.entries()) {
    if (
      !keyframe ||
      typeof keyframe !== 'object' ||
      Array.isArray(keyframe) ||
      Object.keys(keyframe).some((field) => !['time', 'volume'].includes(field)) ||
      !Number.isFinite(keyframe.time) ||
      keyframe.time < 0 ||
      keyframe.time > clip.durationSeconds ||
      keyframe.time <= previousTime ||
      !Number.isFinite(keyframe.volume) ||
      keyframe.volume < 0 ||
      keyframe.volume > 1
    ) {
      throw new TypeError(
        `Clip ${clip.id} volumeKeyframes entry ${index + 1} must have an increasing time and volume from 0 to 1 within the clip.`,
      );
    }
    previousTime = keyframe.time;
  }
}

export function sampleAudioVolumeKeyframes(keyframes = [], time) {
  if (keyframes.length === 0) return 1;
  if (time <= keyframes[0].time) return keyframes[0].volume;
  for (let index = 1; index < keyframes.length; index++) {
    const next = keyframes[index];
    if (time > next.time) continue;
    const previous = keyframes[index - 1];
    const amount = (time - previous.time) / (next.time - previous.time);
    return previous.volume + (next.volume - previous.volume) * amount;
  }
  return keyframes.at(-1).volume;
}

export function validateAudioTrackVolumeKeyframes(keyframes, track, projectDurationSeconds) {
  if (keyframes === undefined) return;
  if (track.kind !== 'audio')
    throw new TypeError(`Track ${track.id} volumeKeyframes are supported only on audio tracks.`);
  if (!Array.isArray(keyframes) || keyframes.length === 0 || keyframes.length > 512) {
    throw new TypeError(`Track ${track.id} volumeKeyframes must be an array with 1 to 512 entries.`);
  }
  if (keyframes[0]?.time !== 0) throw new TypeError(`Track ${track.id} volumeKeyframes must start at time 0.`);
  let previousTime = -1;
  for (const [index, keyframe] of keyframes.entries()) {
    if (
      !keyframe ||
      typeof keyframe !== 'object' ||
      Array.isArray(keyframe) ||
      Object.keys(keyframe).some((field) => !['time', 'volume'].includes(field)) ||
      !Number.isFinite(keyframe.time) ||
      keyframe.time < 0 ||
      keyframe.time > projectDurationSeconds ||
      keyframe.time <= previousTime ||
      !Number.isFinite(keyframe.volume) ||
      keyframe.volume < 0 ||
      keyframe.volume > 1
    ) {
      throw new TypeError(
        `Track ${track.id} volumeKeyframes entry ${index + 1} must have an increasing project time and volume from 0 to 1.`,
      );
    }
    previousTime = keyframe.time;
  }
}

export function sliceAudioVolumeKeyframes(keyframes, start, end) {
  if (!keyframes) return undefined;
  const sliced = [{ time: 0, volume: sampleAudioVolumeKeyframes(keyframes, start) }];
  for (const keyframe of keyframes) {
    if (keyframe.time > start && keyframe.time < end) {
      sliced.push({ time: keyframe.time - start, volume: keyframe.volume });
    }
  }
  if (end > start) sliced.push({ time: end - start, volume: sampleAudioVolumeKeyframes(keyframes, end) });
  return sliced;
}
