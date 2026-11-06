import { isDeepStrictEqual } from 'node:util';
import { validateTimeline } from './validate.mjs';
import { sliceVisualKeyframes } from './keyframes.mjs';
import { sliceSpeedRamp, speedRampDuration, speedRampSourceAtTime } from './speed-ramp.mjs';
import { validateClipTransition } from './transition.mjs';
import { frameRateNumber } from '../media/frame-rate.mjs';
import { sampleAudioVolumeKeyframes, sliceAudioVolumeKeyframes } from './audio-volume.mjs';

export function addTimelineTrack(timeline, track) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) throw new TypeError('Timeline track must be an object.');
  const next = structuredClone(timeline);
  if (next.tracks.some((candidate) => candidate.id === track.id)) throw new TypeError(`Timeline track already exists: ${track.id}`);
  next.tracks.push(structuredClone(track));
  return validateTimeline(next);
}

export function removeTimelineTrack(timeline, trackId) {
  const next = structuredClone(timeline);
  const index = next.tracks.findIndex((candidate) => candidate.id === trackId);
  if (index < 0) throw new TypeError(`Unknown timeline track: ${trackId}`);
  assertTrackEditable(next.tracks[index]);
  next.tracks.splice(index, 1);
  return validateTimeline(next);
}

/** Add or replace a timeline review marker by its stable id. */
export function setTimelineMarker(timeline, marker) {
  validateTimeline(timeline);
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw new TypeError('Timeline marker must be an object.');
  const next = structuredClone(timeline);
  next.markers ??= [];
  const index = next.markers.findIndex((entry) => entry.id === marker.id);
  if (index < 0) next.markers.push(structuredClone(marker));
  else next.markers[index] = structuredClone(marker);
  return validateTimeline(next);
}

/** Remove a timeline review marker by its stable id. */
export function removeTimelineMarker(timeline, markerId) {
  validateTimeline(timeline);
  if (typeof markerId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(markerId)) throw new TypeError('Timeline marker id must be a kebab-case id.');
  const next = structuredClone(timeline);
  const index = (next.markers ?? []).findIndex((marker) => marker.id === markerId);
  if (index < 0) throw new TypeError(`Unknown timeline marker: ${markerId}`);
  next.markers.splice(index, 1);
  return validateTimeline(next);
}

/** Create a renderable, non-destructive timeline window from project time. */
export function extractTimelineRange(timeline, startSeconds, endSeconds) {
  validateTimeline(timeline);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
      || startSeconds < 0 || endSeconds <= startSeconds
      || endSeconds > timeline.project.durationSeconds + 1e-6) {
    throw new TypeError('Timeline range must be a positive time range within the project duration.');
  }
  const end = Math.min(endSeconds, timeline.project.durationSeconds);
  const durationSeconds = end - startSeconds;
  if (durationSeconds < 1 / frameRateNumber(timeline.project.fps) - 1e-9) {
    throw new TypeError('Timeline range must include at least one project frame.');
  }
  const next = structuredClone(timeline);
  next.project.durationSeconds = durationSeconds;
  if (next.markers) {
    next.markers = next.markers
      .filter((marker) => marker.timeSeconds >= startSeconds && marker.timeSeconds <= end)
      .map((marker) => ({ ...marker, timeSeconds: marker.timeSeconds - startSeconds }));
  }
  for (const track of next.tracks) {
    if (track.volumeKeyframes) track.volumeKeyframes = sliceAudioVolumeKeyframes(track.volumeKeyframes, startSeconds, end);
    track.clips = track.clips.flatMap((clip) => {
      const clipStart = clip.timelineStart;
      const clipEnd = clipStart + clip.durationSeconds;
      const overlapStart = Math.max(startSeconds, clipStart);
      const overlapEnd = Math.min(end, clipEnd);
      if (overlapEnd <= overlapStart) return [];
      const localStart = overlapStart - clipStart;
      const localEnd = overlapEnd - clipStart;
      assertRangeDoesNotCutEdgeEffects(clip, localStart, localEnd);
      const segment = sliceTimelineClip(clip, track.kind, localStart, localEnd, overlapStart - startSeconds);
      if (!segment) return [];
      return [segment];
    });
  }
  return validateTimeline(next);
}

function assertRangeDoesNotCutEdgeEffects(clip, localStart, localEnd) {
  if (clip.fadeInSeconds !== undefined && localStart > 0 && localStart < clip.fadeInSeconds) {
    throw new TypeError(`Render range cuts through clip ${clip.id}'s fade-in; start the range before or after the fade.`);
  }
  if (clip.fadeOutSeconds !== undefined && localEnd < clip.durationSeconds
      && localEnd > clip.durationSeconds - clip.fadeOutSeconds) {
    throw new TypeError(`Render range cuts through clip ${clip.id}'s fade-out; end the range before or after the fade.`);
  }
  if (clip.transitionIn && localStart > 0 && localStart < clip.transitionIn.durationSeconds) {
    throw new TypeError(`Render range cuts through clip ${clip.id}'s incoming transition; start the range before or after it.`);
  }
  if (clip.transitionOut && localEnd < clip.durationSeconds
      && localEnd > clip.durationSeconds - clip.transitionOut.durationSeconds) {
    throw new TypeError(`Render range cuts through clip ${clip.id}'s outgoing transition; end the range before or after it.`);
  }
}

export function reorderTimelineTrack(timeline, trackId, order) {
  validateTimeline(timeline);
  if (!Number.isSafeInteger(order) || order < 0 || order >= timeline.tracks.length) {
    throw new TypeError(`Track order must be an integer from 0 to ${timeline.tracks.length - 1}.`);
  }
  const next = structuredClone(timeline);
  const orderedTracks = next.tracks.sort((left, right) => left.order - right.order);
  const currentIndex = orderedTracks.findIndex((track) => track.id === trackId);
  if (currentIndex < 0) throw new TypeError(`Unknown timeline track: ${trackId}`);
  const [track] = orderedTracks.splice(currentIndex, 1);
  orderedTracks.splice(order, 0, track);
  orderedTracks.forEach((candidate, index) => { candidate.order = index; });
  const previousOrders = new Map(timeline.tracks.map((candidate) => [candidate.id, candidate.order]));
  for (const candidate of orderedTracks) {
    if (candidate.locked === true && candidate.order !== previousOrders.get(candidate.id)) {
      throw new TypeError(`Track ${candidate.id} is locked and cannot be reordered.`);
    }
  }
  next.tracks = orderedTracks;
  return validateTimeline(next);
}

export function addTimelineClip(timeline, trackId, clip) {
  if (!clip || typeof clip !== 'object' || Array.isArray(clip)) throw new TypeError('Timeline clip must be an object.');
  const next = structuredClone(timeline);
  const track = next.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  assertTrackEditable(track);
  if (track.clips.some((candidate) => candidate.id === clip.id)) throw new TypeError(`Timeline clip already exists on track ${trackId}: ${clip.id}`);
  track.clips.push(structuredClone(clip));
  next.project.durationSeconds = Math.max(next.project.durationSeconds, clip.timelineStart + clip.durationSeconds);
  return validateTimeline(next);
}

export function duplicateTimelineClip(timeline, trackId, clipId, newClipId, timelineStart) {
  if (!/^[a-z][a-z0-9-]*$/.test(newClipId ?? '')) throw new TypeError('newClipId must be a lowercase kebab-case id.');
  if (!Number.isFinite(timelineStart) || timelineStart < 0) throw new TypeError('timelineStart must be a non-negative number.');
  const { clip } = findClipEntry(timeline, trackId, clipId);
  return addTimelineClip(timeline, trackId, {
    ...structuredClone(clip),
    id: newClipId,
    timelineStart,
  });
}

export function detachAudioFromTimelineClip(timeline, videoTrackId, videoClipId, audioTrackId, audioClipId, audioStreamIndex) {
  if (!/^[a-z][a-z0-9-]*$/.test(audioTrackId ?? '') || !/^[a-z][a-z0-9-]*$/.test(audioClipId ?? '')) {
    throw new TypeError('Detached audio track and clip ids must be kebab-case ids.');
  }
  const next = structuredClone(timeline);
  const videoTrack = next.tracks.find((track) => track.id === videoTrackId);
  if (!videoTrack || videoTrack.kind !== 'video') throw new TypeError(`Unknown video track: ${videoTrackId}`);
  assertTrackEditable(videoTrack);
  const videoClip = videoTrack.clips.find((clip) => clip.id === videoClipId);
  if (!videoClip) throw new TypeError(`Unknown clip ${videoClipId} on track ${videoTrackId}.`);
  const asset = next.assets.find((item) => item.id === videoClip.assetId);
  if (asset?.type === 'image' || asset?.hasAudio === false) {
    throw new TypeError(`Video clip ${videoClipId} references media without an audio stream.`);
  }

  let audioTrack = next.tracks.find((track) => track.id === audioTrackId);
  if (audioTrack && audioTrack.kind !== 'audio') throw new TypeError(`Track ${audioTrackId} is not an audio track.`);
  if (audioTrack) assertTrackEditable(audioTrack);
  if (!audioTrack) {
    if (next.tracks.some((track) => track.id === audioTrackId)) throw new TypeError(`Timeline track already exists: ${audioTrackId}`);
    const order = next.tracks.reduce((maximum, track) => Math.max(maximum, track.order), -1) + 1;
    audioTrack = { id: audioTrackId, kind: 'audio', order, clips: [] };
    next.tracks.push(audioTrack);
  }
  if (audioTrack.clips.some((clip) => clip.id === audioClipId)) {
    throw new TypeError(`Timeline clip already exists on track ${audioTrackId}: ${audioClipId}`);
  }

  const audioClip = {
    id: audioClipId,
    assetId: videoClip.assetId,
    sourceIn: videoClip.sourceIn,
    sourceOut: videoClip.sourceOut,
    timelineStart: videoClip.timelineStart,
    durationSeconds: videoClip.durationSeconds,
    ...(audioStreamIndex === undefined ? {} : { audioStreamIndex }),
    ...(videoClip.reverse === true ? { reverse: true } : {}),
    ...(videoClip.playbackRate === undefined ? {} : { playbackRate: videoClip.playbackRate }),
    ...(videoClip.speedRamp === undefined ? {} : { speedRamp: structuredClone(videoClip.speedRamp) }),
  };
  audioTrack.clips.push(audioClip);
  return validateTimeline(next);
}

export function removeTimelineClip(timeline, trackId, clipId) {
  const next = structuredClone(timeline);
  const track = next.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  assertTrackEditable(track);
  const index = track.clips.findIndex((candidate) => candidate.id === clipId);
  if (index < 0) throw new TypeError(`Unknown clip ${clipId} on track ${trackId}.`);
  track.clips.splice(index, 1);
  return validateTimeline(next);
}

export function rippleDeleteTimelineClip(timeline, trackId, clipId) {
  validateTimeline(timeline);
  const targetTrack = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!targetTrack) throw new TypeError(`Unknown timeline track: ${trackId}`);
  const target = targetTrack.clips.find((clip) => clip.id === clipId);
  if (!target) throw new TypeError(`Unknown clip ${clipId} on track ${trackId}.`);
  return rippleDeleteTimelineRange(timeline, target.timelineStart, target.timelineStart + target.durationSeconds);
}

export function rippleDeleteTimelineRange(timeline, cutStart, cutEnd) {
  validateTimeline(timeline);
  if (!Number.isFinite(cutStart) || !Number.isFinite(cutEnd)
      || cutStart < 0 || cutEnd <= cutStart || cutEnd > timeline.project.durationSeconds + 1e-6) {
    throw new TypeError('Ripple delete range must be a positive time range within the project duration.');
  }
  cutEnd = Math.min(cutEnd, timeline.project.durationSeconds);
  const cutDuration = cutEnd - cutStart;
  for (const track of timeline.tracks) {
    if (track.locked === true && (track.clips.some((clip) => clip.timelineStart + clip.durationSeconds > cutStart)
        || track.volumeKeyframes !== undefined)) {
      throw new TypeError(`Ripple delete would change locked track ${track.id}. Unlock it before making a synchronized ripple edit.`);
    }
  }
  const next = structuredClone(timeline);
  const usedIds = new Set(next.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));

  for (const track of next.tracks) {
    if (track.volumeKeyframes) track.volumeKeyframes = rippleTrackVolumeKeyframes(track.volumeKeyframes, cutStart, cutEnd);
    const clips = [];
    for (const clip of track.clips) {
      const clipStart = clip.timelineStart;
      const clipEnd = clipStart + clip.durationSeconds;
      if (clipEnd <= cutStart) {
        clips.push(clip);
        continue;
      }
      if (clipStart >= cutEnd) {
        clip.timelineStart = clipStart - cutDuration;
        clips.push(clip);
        continue;
      }

      const localCutStart = Math.max(0, cutStart - clipStart);
      const localCutEnd = Math.min(clip.durationSeconds, cutEnd - clipStart);
      const keepLeft = localCutStart > 1e-9;
      const keepRight = clip.durationSeconds - localCutEnd > 1e-9;
      if (keepLeft) clips.push(sliceTimelineClip(clip, track.kind, 0, localCutStart, clipStart));
      if (keepRight) {
        const rightStart = Math.max(clipStart, cutEnd) - cutDuration;
        const right = sliceTimelineClip(clip, track.kind, localCutEnd, clip.durationSeconds, rightStart);
        if (keepLeft) right.id = uniqueRippleClipId(clip.id, usedIds);
        clips.push(right);
      }
    }
    track.clips = clips.filter(Boolean);
  }

  next.project.durationSeconds = Math.max(1 / frameRateNumber(next.project.fps), timeline.project.durationSeconds - cutDuration);
  if (next.markers) {
    next.markers = next.markers
      .filter((marker) => marker.timeSeconds < cutStart || marker.timeSeconds >= cutEnd)
      .map((marker) => marker.timeSeconds < cutStart ? marker : { ...marker, timeSeconds: marker.timeSeconds - cutDuration });
  }
  return validateTimeline(next);
}

export function insertTimelineGap(timeline, timelineStart, durationSeconds) {
  validateTimeline(timeline);
  if (!Number.isFinite(timelineStart) || timelineStart < 0 || timelineStart > timeline.project.durationSeconds) {
    throw new TypeError('timelineStart must be within the project duration.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('durationSeconds must be a positive number.');
  }
  for (const track of timeline.tracks) {
    if (track.locked === true && (track.clips.some((clip) => clip.timelineStart + clip.durationSeconds > timelineStart)
        || track.volumeKeyframes !== undefined)) {
      throw new TypeError(`Gap insertion would change locked track ${track.id}. Unlock it before making a synchronized timeline edit.`);
    }
  }

  const next = structuredClone(timeline);
  if (next.markers) {
    next.markers = next.markers.map((marker) => marker.timeSeconds >= timelineStart
      ? { ...marker, timeSeconds: marker.timeSeconds + durationSeconds }
      : marker);
  }
  const usedIds = new Set(next.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  for (const track of next.tracks) {
    if (track.volumeKeyframes) track.volumeKeyframes = insertTrackVolumeGap(track.volumeKeyframes, timelineStart, durationSeconds);
    const clips = [];
    for (const clip of track.clips) {
      const clipStart = clip.timelineStart;
      const clipEnd = clipStart + clip.durationSeconds;
      if (clipStart >= timelineStart) {
        clip.timelineStart += durationSeconds;
        clips.push(clip);
        continue;
      }
      if (clipEnd <= timelineStart) {
        clips.push(clip);
        continue;
      }

      const splitOffset = timelineStart - clipStart;
      const left = sliceTimelineClip(clip, track.kind, 0, splitOffset, clipStart);
      const right = sliceTimelineClip(clip, track.kind, splitOffset, clip.durationSeconds, timelineStart + durationSeconds);
      if (left) clips.push(left);
      if (right) {
        right.id = uniqueRippleClipId(`${clip.id}-gap-right`, usedIds);
        clips.push(right);
      }
    }
    track.clips = clips;
  }

  next.project.durationSeconds += durationSeconds;
  return validateTimeline(next);
}

function rippleTrackVolumeKeyframes(keyframes, cutStart, cutEnd) {
  const cutDuration = cutEnd - cutStart;
  const retained = keyframes.filter((keyframe) => keyframe.time < cutStart)
    .concat(keyframes.filter((keyframe) => keyframe.time >= cutEnd)
      .map((keyframe) => ({ ...keyframe, time: keyframe.time - cutDuration })));
  if (!retained.some((keyframe) => Math.abs(keyframe.time - cutStart) < 1e-9)) {
    retained.push({ time: cutStart, volume: sampleAudioVolumeKeyframes(keyframes, cutEnd) });
  }
  return retained.sort((left, right) => left.time - right.time);
}

function insertTrackVolumeGap(keyframes, timelineStart, durationSeconds) {
  const retained = keyframes.filter((keyframe) => keyframe.time <= timelineStart)
    .concat(keyframes.filter((keyframe) => keyframe.time > timelineStart)
      .map((keyframe) => ({ ...keyframe, time: keyframe.time + durationSeconds })));
  const heldVolume = sampleAudioVolumeKeyframes(keyframes, timelineStart);
  if (!retained.some((keyframe) => Math.abs(keyframe.time - timelineStart) < 1e-9)) {
    retained.push({ time: timelineStart, volume: heldVolume });
  }
  if (!retained.some((keyframe) => Math.abs(keyframe.time - (timelineStart + durationSeconds)) < 1e-9)) {
    retained.push({ time: timelineStart + durationSeconds, volume: heldVolume });
  }
  return retained.sort((left, right) => left.time - right.time);
}

export function moveTimelineClip(timeline, trackId, clipId, timelineStart) {
  if (!Number.isFinite(timelineStart) || timelineStart < 0) throw new TypeError('timelineStart must be a non-negative number.');
  const next = structuredClone(timeline);
  const clip = findClip(next, trackId, clipId);
  clip.timelineStart = timelineStart;
  next.project.durationSeconds = Math.max(next.project.durationSeconds, timelineStart + clip.durationSeconds);
  return validateTimeline(next);
}

export function moveTimelineClipToTrack(timeline, trackId, clipId, targetTrackId, timelineStart) {
  if (timelineStart !== undefined && (!Number.isFinite(timelineStart) || timelineStart < 0)) {
    throw new TypeError('timelineStart must be a non-negative number.');
  }
  if (trackId === targetTrackId) {
    findClipEntry(timeline, trackId, clipId);
    return timelineStart === undefined ? validateTimeline(structuredClone(timeline)) : moveTimelineClip(timeline, trackId, clipId, timelineStart);
  }

  const next = structuredClone(timeline);
  const { track: sourceTrack, clip, index } = findClipEntry(next, trackId, clipId);
  const targetTrack = next.tracks.find((candidate) => candidate.id === targetTrackId);
  if (!targetTrack) throw new TypeError(`Unknown timeline track: ${targetTrackId}`);
  assertTrackEditable(targetTrack);
  if (sourceTrack.kind !== targetTrack.kind) {
    throw new TypeError(`Cannot move a ${sourceTrack.kind} clip to a track of kind ${targetTrack.kind}.`);
  }
  if (targetTrack.clips.some((candidate) => candidate.id === clipId)) {
    throw new TypeError(`Timeline clip already exists on track ${targetTrackId}: ${clipId}`);
  }

  sourceTrack.clips.splice(index, 1);
  if (timelineStart !== undefined) clip.timelineStart = timelineStart;
  targetTrack.clips.push(clip);
  next.project.durationSeconds = Math.max(next.project.durationSeconds, clip.timelineStart + clip.durationSeconds);
  return validateTimeline(next);
}

export function replaceTimelineClipAsset(timeline, trackId, clipId, assetId, options = {}) {
  validateTimeline(timeline);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Replacement media options must be an object.');
  const allowed = new Set(['sourceIn', 'sourceOut', 'audioStreamIndex', 'videoStreamIndex', 'playbackRate', 'reverse', 'speedRamp']);
  for (const field of Object.keys(options)) {
    if (!allowed.has(field)) throw new TypeError(`Unsupported replacement media option: ${field}.`);
    if (options[field] === undefined) throw new TypeError('Replacement media options must not be undefined.');
  }
  if (typeof assetId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(assetId)) throw new TypeError('Replacement asset id must be a lowercase kebab-case id.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind === 'overlay') throw new TypeError('Overlay clips do not reference media assets.');
  if (!next.assets.some((asset) => asset.id === assetId)) throw new TypeError(`Unknown timeline asset: ${assetId}`);
  clip.assetId = assetId;
  if (options.sourceIn !== undefined) clip.sourceIn = options.sourceIn;
  if (options.sourceOut !== undefined) clip.sourceOut = options.sourceOut;
  if (options.audioStreamIndex === null) delete clip.audioStreamIndex;
  else if (options.audioStreamIndex !== undefined) clip.audioStreamIndex = options.audioStreamIndex;
  if (options.videoStreamIndex === null) delete clip.videoStreamIndex;
  else if (options.videoStreamIndex !== undefined) clip.videoStreamIndex = options.videoStreamIndex;
  if (options.playbackRate === null) delete clip.playbackRate;
  else if (options.playbackRate !== undefined) clip.playbackRate = options.playbackRate;
  if (options.reverse !== undefined) clip.reverse = options.reverse;
  if (options.speedRamp === null) delete clip.speedRamp;
  else if (options.speedRamp !== undefined) clip.speedRamp = structuredClone(options.speedRamp);
  return validateTimeline(next);
}

export function setTimelineClipSpeed(timeline, trackId, clipId, speed) {
  validateTimeline(timeline);
  if (!speed || typeof speed !== 'object' || Array.isArray(speed)) throw new TypeError('Clip speed must be an object.');
  const fields = Object.keys(speed);
  if (fields.length !== 1 || !['playbackRate', 'speedRamp'].includes(fields[0])) {
    throw new TypeError('Set exactly one of playbackRate or speedRamp.');
  }
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'video' && track.kind !== 'audio') throw new TypeError('Playback speed is supported on video and audio clips.');
  const asset = next.assets.find((entry) => entry.id === clip.assetId);
  if (track.kind === 'video' && asset?.type === 'image') throw new TypeError('Still-image clips do not support playback speed.');
  const sourceSpan = clip.sourceOut - clip.sourceIn;
  const previousDuration = clip.durationSeconds;
  if (Object.hasOwn(speed, 'playbackRate')) {
    const playbackRate = speed.playbackRate === null ? 1 : speed.playbackRate;
    if (!Number.isFinite(playbackRate) || playbackRate < 0.1 || playbackRate > 5) {
      throw new TypeError('Playback rate must be from 0.1 to 5, or null to reset to normal speed.');
    }
    delete clip.speedRamp;
    if (playbackRate === 1) delete clip.playbackRate;
    else clip.playbackRate = playbackRate;
    clip.durationSeconds = sourceSpan / playbackRate;
  } else if (speed.speedRamp === null) {
    delete clip.speedRamp;
    delete clip.playbackRate;
    clip.durationSeconds = sourceSpan;
  } else {
    if (clip.reverse) throw new TypeError('Reverse playback cannot be combined with a speed ramp.');
    if (!Array.isArray(speed.speedRamp) || speed.speedRamp.length < 2) throw new TypeError('Speed ramp must contain at least two points.');
    clip.speedRamp = structuredClone(speed.speedRamp);
    delete clip.playbackRate;
    clip.durationSeconds = speedRampDuration(clip.speedRamp);
  }
  scaleClipLocalTiming(clip, previousDuration, clip.durationSeconds);
  next.project.durationSeconds = Math.max(next.project.durationSeconds, clip.timelineStart + clip.durationSeconds);
  return validateTimeline(next);
}

function scaleClipLocalTiming(clip, previousDuration, nextDuration) {
  const scale = nextDuration / previousDuration;
  for (const frame of clip.keyframes ?? []) frame.time *= scale;
  for (const keyframe of clip.volumeKeyframes ?? []) keyframe.time *= scale;
  for (const word of clip.wordTimings ?? []) {
    word.start *= scale;
    word.end *= scale;
  }
  for (const field of ['fadeInSeconds', 'fadeOutSeconds']) {
    if (clip[field] !== undefined) clip[field] *= scale;
  }
  for (const field of ['transitionIn', 'transitionOut']) {
    if (clip[field] !== undefined) clip[field].durationSeconds *= scale;
  }
}

export function trimTimelineClip(timeline, trackId, clipId, sourceIn, sourceOut) {
  if (!Number.isFinite(sourceIn) || !Number.isFinite(sourceOut)) throw new TypeError('Trim source bounds must be finite numbers.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind === 'overlay') throw new TypeError('Overlay clips cannot be source-trimmed.');
  if (sourceIn < clip.sourceIn || sourceOut > clip.sourceOut || sourceOut <= sourceIn) throw new TypeError('Trim bounds must be a positive subrange of the existing source range.');
  const sourceOffset = sourceIn - clip.sourceIn;
  const sourceEndOffset = sourceOut - clip.sourceIn;
  const trimBefore = clip.reverse
    ? (clip.sourceOut - sourceOut) / (clip.playbackRate ?? 1)
    : clip.speedRamp
    ? speedRampDuration(clip.speedRamp, 0, sourceOffset)
    : sourceOffset / (clip.playbackRate ?? 1);
  const durationSeconds = clip.speedRamp
    ? speedRampDuration(clip.speedRamp, sourceOffset, sourceEndOffset)
    : (sourceOut - sourceIn) / (clip.playbackRate ?? 1);
  clip.keyframes = sliceVisualKeyframes(clip.keyframes, trimBefore, trimBefore + durationSeconds);
  clip.volumeKeyframes = sliceAudioVolumeKeyframes(clip.volumeKeyframes, trimBefore, trimBefore + durationSeconds);
  if (clip.speedRamp) clip.speedRamp = sliceSpeedRamp(clip.speedRamp, sourceOffset, sourceEndOffset);
  clip.timelineStart += trimBefore;
  clip.sourceIn = sourceIn;
  clip.sourceOut = sourceOut;
  clip.durationSeconds = durationSeconds;
  clip.fadeInSeconds = Math.min(clip.fadeInSeconds ?? 0, clip.durationSeconds);
  clip.fadeOutSeconds = Math.min(clip.fadeOutSeconds ?? 0, clip.durationSeconds - clip.fadeInSeconds);
  return validateTimeline(next);
}

export function slipTimelineClip(timeline, trackId, clipId, sourceDelta) {
  validateTimeline(timeline);
  if (!Number.isFinite(sourceDelta)) throw new TypeError('sourceDelta must be a finite number.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind === 'overlay') throw new TypeError('Overlay clips cannot be source-slipped.');
  clip.sourceIn += sourceDelta;
  clip.sourceOut += sourceDelta;
  return validateTimeline(next);
}

export function splitTimelineClip(timeline, trackId, clipId, splitAt, rightClipId = `${clipId}-right`) {
  if (!Number.isFinite(splitAt)) throw new TypeError('splitAt must be a finite timeline time.');
  if (!/^[a-z][a-z0-9-]*$/.test(rightClipId)) throw new TypeError('rightClipId must be a lowercase kebab-case id.');
  const next = structuredClone(timeline);
  const { track, clip, index } = findClipEntry(next, trackId, clipId);
  if (track.kind === 'overlay') throw new TypeError('Overlay clips cannot be source-split.');
  const splitOffset = splitAt - clip.timelineStart;
  if (splitOffset <= 0 || splitOffset >= clip.durationSeconds) throw new TypeError('splitAt must fall strictly inside the clip.');
  if (track.clips.some((candidate) => candidate.id === rightClipId)) throw new TypeError(`Clip id already exists on track ${trackId}: ${rightClipId}`);

  const originalDuration = clip.durationSeconds;
  const originalKeyframes = clip.keyframes;
  const originalVolumeKeyframes = clip.volumeKeyframes;
  const originalSpeedRamp = clip.speedRamp;
  const originalStart = clip.sourceIn;
  const originalEnd = clip.sourceOut;
  const sourceSplit = clip.reverse
    ? originalEnd - splitOffset * (clip.playbackRate ?? 1)
    : originalStart + (originalSpeedRamp
      ? speedRampSourceAtTime(originalSpeedRamp, splitOffset)
      : splitOffset * (clip.playbackRate ?? 1));
  const originalFadeOut = clip.fadeOutSeconds ?? 0;
  const originalFadeIn = clip.fadeInSeconds ?? 0;
  const originalTransitionOut = clip.transitionOut;
  if (clip.reverse) clip.sourceIn = sourceSplit;
  else clip.sourceOut = sourceSplit;
  clip.durationSeconds = splitOffset;
  clip.keyframes = sliceVisualKeyframes(originalKeyframes, 0, splitOffset);
  clip.volumeKeyframes = sliceAudioVolumeKeyframes(originalVolumeKeyframes, 0, splitOffset);
  if (originalSpeedRamp) clip.speedRamp = sliceSpeedRamp(originalSpeedRamp, 0, sourceSplit - clip.sourceIn);
  clip.fadeInSeconds = Math.min(originalFadeIn, splitOffset);
  clip.fadeOutSeconds = 0;
  delete clip.transitionOut;
  const right = {
    ...clip,
    id: rightClipId,
    sourceIn: clip.reverse ? originalStart : sourceSplit,
    sourceOut: clip.reverse ? sourceSplit : originalEnd,
    timelineStart: splitAt,
    durationSeconds: originalDuration - splitOffset,
    keyframes: sliceVisualKeyframes(originalKeyframes, splitOffset, originalDuration),
    volumeKeyframes: sliceAudioVolumeKeyframes(originalVolumeKeyframes, splitOffset, originalDuration),
    ...(originalSpeedRamp ? { speedRamp: sliceSpeedRamp(originalSpeedRamp, sourceSplit - clip.sourceIn, originalSpeedRamp.at(-1).sourceOffset) } : {}),
    fadeInSeconds: 0,
    fadeOutSeconds: Math.min(originalFadeOut, originalDuration - splitOffset),
  };
  delete right.transitionIn;
  if (originalTransitionOut) right.transitionOut = originalTransitionOut;
  track.clips.splice(index + 1, 0, right);
  return validateTimeline(next);
}

export function crossfadeTimelineClips(timeline, trackId, outgoingClipId, incomingClipId, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new TypeError('Crossfade duration must be a positive number.');
  const next = structuredClone(timeline);
  const track = next.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  assertTrackEditable(track);
  const outgoing = track.clips.find((clip) => clip.id === outgoingClipId);
  const incoming = track.clips.find((clip) => clip.id === incomingClipId);
  if (!outgoing || !incoming) throw new TypeError(`Crossfade clips must both belong to track ${trackId}.`);
  if (outgoing === incoming) throw new TypeError('A crossfade requires two different clips.');
  const outgoingEnd = outgoing.timelineStart + outgoing.durationSeconds;
  const overlapSeconds = outgoingEnd - incoming.timelineStart;
  if (Math.abs(overlapSeconds - durationSeconds) > 1e-6) throw new TypeError('Crossfade clips must already overlap by the requested duration.');
  if (durationSeconds > outgoing.durationSeconds || durationSeconds > incoming.durationSeconds) throw new TypeError('Crossfade duration cannot exceed either clip duration.');
  if (outgoing.timelineStart >= incoming.timelineStart) throw new TypeError('Crossfade clips must be ordered outgoing then incoming.');
  if (track.kind === 'audio') outgoing.fadeOutSeconds = durationSeconds;
  else delete outgoing.fadeOutSeconds;
  incoming.fadeInSeconds = durationSeconds;
  return validateTimeline(next);
}

export function setTimelineTransition(timeline, trackId, clipId, edge, transition) {
  if (!['in', 'out'].includes(edge)) throw new TypeError('Transition edge must be in or out.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'video' && track.kind !== 'overlay') throw new TypeError('Transitions are supported on video and overlay tracks.');
  const field = edge === 'in' ? 'transitionIn' : 'transitionOut';
  if (transition === null) delete clip[field];
  else clip[field] = validateClipTransition(transition, clip, `Clip ${clip.id} ${field}`);
  return validateTimeline(next);
}

export function setTimelineClipReverse(timeline, trackId, clipId, reverse) {
  if (typeof reverse !== 'boolean') throw new TypeError('reverse must be a boolean.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'video' && track.kind !== 'audio') throw new TypeError(`Reverse playback is supported on video and audio tracks, not ${track.kind}.`);
  if (reverse) clip.reverse = true;
  else delete clip.reverse;
  return validateTimeline(next);
}

export function setTimelineClipAudioEffects(timeline, trackId, clipId, effects) {
  if (effects !== null && !Array.isArray(effects)) throw new TypeError('audioEffects must be an array or null.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'audio') throw new TypeError(`Audio effects are supported on audio tracks, not ${track.kind}.`);
  if (effects === null || effects.length === 0) delete clip.audioEffects;
  else clip.audioEffects = structuredClone(effects);
  return validateTimeline(next);
}

export function setTimelineClipVolumeKeyframes(timeline, trackId, clipId, keyframes) {
  if (keyframes !== null && !Array.isArray(keyframes)) throw new TypeError('volumeKeyframes must be an array or null.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'audio') throw new TypeError(`Volume keyframes are supported on audio tracks, not ${track.kind}.`);
  if (keyframes === null || keyframes.length === 0) delete clip.volumeKeyframes;
  else clip.volumeKeyframes = structuredClone(keyframes);
  return validateTimeline(next);
}

export function setTimelineClipAudioState(timeline, trackId, clipId, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Audio state must be an object.');
  const fields = Object.keys(state);
  const allowed = ['volume', 'fadeInSeconds', 'fadeOutSeconds', 'audioStreamIndex'];
  if (fields.length === 0 || fields.some((field) => !allowed.includes(field))) {
    throw new TypeError(`Audio state must set one or more of: ${allowed.join(', ')}.`);
  }
  if (fields.some((field) => state[field] === undefined)) throw new TypeError('Audio state values must not be undefined; use null to clear an override.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'audio') throw new TypeError(`Audio state is supported on audio tracks, not ${track.kind}.`);
  for (const field of fields) {
    if (state[field] === null) delete clip[field];
    else clip[field] = state[field];
  }
  return validateTimeline(next);
}

export function setTimelineClipVideoState(timeline, trackId, clipId, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Video state must be an object.');
  const fields = Object.keys(state);
  if (fields.length !== 1 || fields[0] !== 'videoStreamIndex') {
    throw new TypeError('Video state must set videoStreamIndex.');
  }
  if (state.videoStreamIndex === undefined) throw new TypeError('Video state values must not be undefined; use null to clear an override.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'video') throw new TypeError(`Video state is supported on video tracks, not ${track.kind}.`);
  if (state.videoStreamIndex === null) delete clip.videoStreamIndex;
  else clip.videoStreamIndex = state.videoStreamIndex;
  return validateTimeline(next);
}

export function setTimelineClipKeyframes(timeline, trackId, clipId, keyframes) {
  if (keyframes !== null && !Array.isArray(keyframes)) throw new TypeError('keyframes must be an array or null.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'video' && track.kind !== 'overlay') throw new TypeError(`Visual keyframes are supported on video and overlay tracks, not ${track.kind}.`);
  if (keyframes === null || keyframes.length === 0) delete clip.keyframes;
  else clip.keyframes = structuredClone(keyframes);
  return validateTimeline(next);
}

export function setTimelineClipFraming(timeline, trackId, clipId, framing) {
  if (!framing || typeof framing !== 'object' || Array.isArray(framing)) throw new TypeError('framing must be an object.');
  const fields = Object.keys(framing);
  if (fields.length === 0 || fields.some((field) => !['fit', 'x', 'y', 'width', 'height'].includes(field))) {
    throw new TypeError('framing must set one or more of fit, x, y, width, or height.');
  }
  if (fields.some((field) => framing[field] === undefined)) throw new TypeError('framing values must not be undefined; use null to clear an override.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'video') throw new TypeError(`Static framing is supported on video tracks, not ${track.kind}.`);
  for (const field of fields) {
    if (framing[field] === null) delete clip[field];
    else clip[field] = framing[field];
  }
  return validateTimeline(next);
}

export function setTimelineTrackState(timeline, trackId, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Track state must be an object.');
  const next = structuredClone(timeline);
  validateTimeline(next);
  const track = next.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  const allowed = track.kind === 'audio' ? ['muted', 'solo', 'volume', 'volumeKeyframes', 'audioEffects', 'locked'] : ['visible', 'locked'];
  const fields = Object.keys(state);
  if (fields.length === 0 || fields.some((field) => !allowed.includes(field))) {
    throw new TypeError(`Track ${trackId} state must set one or more of: ${allowed.join(', ')}.`);
  }
  if (fields.some((field) => state[field] === undefined)) throw new TypeError('Track state values must not be undefined; use null to clear an override.');
  if (fields.includes('locked') && fields.length !== 1) throw new TypeError('Set or clear track lock state in a separate operation.');
  if (track.locked === true && fields.some((field) => field !== 'locked')) {
    throw new TypeError(`Track ${trackId} is locked. Unlock it before editing track state.`);
  }
  for (const field of fields) {
    if (state[field] === null) delete track[field];
    else track[field] = state[field];
  }
  return validateTimeline(next);
}

export function setTimelineClipState(timeline, trackId, clipId, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Clip state must be an object.');
  const fields = Object.keys(state);
  if (fields.length !== 1 || fields[0] !== 'enabled') throw new TypeError('Clip state must set enabled.');
  if (state.enabled !== null && typeof state.enabled !== 'boolean') throw new TypeError('Clip enabled must be a boolean or null.');
  const next = structuredClone(timeline);
  const { clip } = findClipEntry(next, trackId, clipId);
  if (state.enabled === null) delete clip.enabled;
  else clip.enabled = state.enabled;
  return validateTimeline(next);
}

export function setTimelineTrackAudioEffects(timeline, trackId, effects) {
  if (effects !== null && !Array.isArray(effects)) throw new TypeError('Track audioEffects must be an array or null.');
  const next = structuredClone(timeline);
  validateTimeline(next);
  const track = next.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  if (track.kind !== 'audio') throw new TypeError(`Track audio effects are supported on audio tracks, not ${track.kind}.`);
  assertTrackEditable(track);
  if (effects === null || effects.length === 0) delete track.audioEffects;
  else track.audioEffects = structuredClone(effects);
  return validateTimeline(next);
}

export function setTimelineAudioMix(timeline, audioMix) {
  if (audioMix === undefined) throw new TypeError('audioMix must be an object or null.');
  const next = structuredClone(timeline);
  if (audioMix === null) delete next.audioMix;
  else next.audioMix = structuredClone(audioMix);
  return validateTimeline(next);
}

export function setTimelineAudioMastering(timeline, audioMastering) {
  if (audioMastering === undefined) throw new TypeError('audioMastering must be an object or null.');
  const next = structuredClone(timeline);
  if (audioMastering === null) delete next.audioMastering;
  else next.audioMastering = structuredClone(audioMastering);
  return validateTimeline(next);
}

export function setTimelineProjectState(timeline, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Project state must be an object.');
  const fields = Object.keys(state);
  if (fields.length === 0 || fields.some((field) => !['durationSeconds', 'sourceFit'].includes(field))) {
    throw new TypeError('Project state must set one or more of: durationSeconds, sourceFit.');
  }
  if (fields.some((field) => state[field] === undefined)) throw new TypeError('Project state values must not be undefined; use null to clear sourceFit.');
  const next = structuredClone(timeline);
  for (const field of fields) {
    if (field === 'sourceFit' && state[field] === null) delete next.project.sourceFit;
    else next.project[field] = structuredClone(state[field]);
  }
  return validateTimeline(next);
}

export function setTimelineOverlay(timeline, trackId, clipId, properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new TypeError('Overlay properties must be an object.');
  const allowed = [
    'text', 'composition', 'x', 'y', 'width', 'height', 'fontSize', 'fontFamily', 'fontWeight',
    'lineHeight', 'verticalAlign', 'paddingPixels', 'color', 'backgroundColor', 'textAlign',
    'wordWrap', 'wordsPerLine', 'wordTimings', 'wordHighlightColor', 'wordHighlightAnimation',
    'textOutline', 'textShadow',
  ];
  const fields = Object.keys(properties);
  if (fields.length === 0 || fields.some((field) => !allowed.includes(field))) {
    throw new TypeError(`Overlay properties must set one or more of: ${allowed.join(', ')}.`);
  }
  if (fields.some((field) => properties[field] === undefined)) throw new TypeError('Overlay property values must not be undefined; use null to clear an override.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind !== 'overlay') throw new TypeError(`Overlay properties are supported on overlay tracks, not ${track.kind}.`);
  for (const field of fields) {
    if (properties[field] === null) delete clip[field];
    else clip[field] = structuredClone(properties[field]);
  }
  return validateTimeline(next);
}

export function editTimeline(timeline, operation) {
  if (!operation || typeof operation !== 'object') throw new TypeError('Timeline edit operation must be an object.');
  const { type, trackId, clipId } = operation;
  if (type === 'add-track') return addTimelineTrack(timeline, operation.track);
  if (type === 'set-marker') return setTimelineMarker(timeline, operation.marker);
  if (type === 'remove-marker') return removeTimelineMarker(timeline, operation.markerId);
  if (type === 'remove-track') return removeTimelineTrack(timeline, operation.trackId);
  if (type === 'reorder-track') return reorderTimelineTrack(timeline, operation.trackId, operation.order);
  if (type === 'add-clip') return addTimelineClip(timeline, trackId, operation.clip);
  if (type === 'duplicate-clip') return duplicateTimelineClip(timeline, trackId, clipId, operation.newClipId, operation.timelineStart);
  if (type === 'detach-audio') return detachAudioFromTimelineClip(timeline, trackId, clipId, operation.audioTrackId, operation.audioClipId, operation.audioStreamIndex);
  if (type === 'remove-clip') return removeTimelineClip(timeline, trackId, clipId);
  if (type === 'ripple-delete') return rippleDeleteTimelineClip(timeline, trackId, clipId);
  if (type === 'ripple-delete-range') return rippleDeleteTimelineRange(timeline, operation.startSeconds, operation.endSeconds);
  if (type === 'insert-gap') return insertTimelineGap(timeline, operation.timelineStart, operation.durationSeconds);
  if (type === 'move') return moveTimelineClip(timeline, trackId, clipId, operation.timelineStart);
  if (type === 'move-track') return moveTimelineClipToTrack(timeline, trackId, clipId, operation.targetTrackId, operation.timelineStart);
  if (type === 'set-speed') return setTimelineClipSpeed(timeline, trackId, clipId, operation.speed);
  if (type === 'replace-asset') return replaceTimelineClipAsset(timeline, trackId, clipId, operation.assetId, {
    ...(operation.sourceIn === undefined ? {} : { sourceIn: operation.sourceIn }),
    ...(operation.sourceOut === undefined ? {} : { sourceOut: operation.sourceOut }),
    ...(operation.audioStreamIndex === undefined ? {} : { audioStreamIndex: operation.audioStreamIndex }),
    ...(operation.videoStreamIndex === undefined ? {} : { videoStreamIndex: operation.videoStreamIndex }),
    ...(operation.playbackRate === undefined ? {} : { playbackRate: operation.playbackRate }),
    ...(operation.reverse === undefined ? {} : { reverse: operation.reverse }),
    ...(operation.speedRamp === undefined ? {} : { speedRamp: operation.speedRamp }),
  });
  if (type === 'trim') return trimTimelineClip(timeline, trackId, clipId, operation.sourceIn, operation.sourceOut);
  if (type === 'slip') return slipTimelineClip(timeline, trackId, clipId, operation.sourceDelta);
  if (type === 'split') return splitTimelineClip(timeline, trackId, clipId, operation.splitAt, operation.rightClipId);
  if (type === 'crossfade') return crossfadeTimelineClips(timeline, trackId, clipId, operation.incomingClipId, operation.durationSeconds);
  if (type === 'transition') return setTimelineTransition(timeline, trackId, clipId, operation.edge, operation.transition);
  if (type === 'set-reverse') return setTimelineClipReverse(timeline, trackId, clipId, operation.reverse);
  if (type === 'set-audio-effects') return setTimelineClipAudioEffects(timeline, trackId, clipId, operation.audioEffects);
  if (type === 'set-volume-keyframes') return setTimelineClipVolumeKeyframes(timeline, trackId, clipId, operation.volumeKeyframes);
  if (type === 'set-audio-state') return setTimelineClipAudioState(timeline, trackId, clipId, operation.state);
  if (type === 'set-video-state') return setTimelineClipVideoState(timeline, trackId, clipId, operation.state);
  if (type === 'set-clip-state') return setTimelineClipState(timeline, trackId, clipId, operation.state);
  if (type === 'set-keyframes') return setTimelineClipKeyframes(timeline, trackId, clipId, operation.keyframes);
  if (type === 'set-framing') return setTimelineClipFraming(timeline, trackId, clipId, operation.framing);
  if (type === 'set-track-state') return setTimelineTrackState(timeline, trackId, operation.state);
  if (type === 'set-track-audio-effects') return setTimelineTrackAudioEffects(timeline, trackId, operation.audioEffects);
  if (type === 'set-audio-mix') return setTimelineAudioMix(timeline, operation.audioMix);
  if (type === 'set-audio-mastering') return setTimelineAudioMastering(timeline, operation.audioMastering);
  if (type === 'set-project-state') return setTimelineProjectState(timeline, operation.state);
  if (type === 'set-overlay') return setTimelineOverlay(timeline, trackId, clipId, operation.properties);
  throw new TypeError('Timeline edit type must be add-track, set-marker, remove-marker, remove-track, reorder-track, add-clip, duplicate-clip, detach-audio, remove-clip, ripple-delete, ripple-delete-range, insert-gap, move, move-track, replace-asset, set-speed, trim, slip, split, crossfade, transition, set-reverse, set-audio-effects, set-track-audio-effects, set-audio-mix, set-audio-mastering, set-project-state, set-volume-keyframes, set-audio-state, set-video-state, set-clip-state, set-keyframes, set-framing, set-track-state, or set-overlay.');
}

/** Apply a non-empty edit plan in order, returning one validated result or no changes. */
export function editTimelineBatch(timeline, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new TypeError('Timeline edit batch must be a non-empty array of operations.');
  }
  let next = timeline;
  for (const operation of operations) next = editTimeline(next, operation);
  return next;
}

/** Describe the exact result of an edit plan without changing the source timeline. */
export function previewTimelineEdit(timeline, operationOrOperations) {
  const operations = Array.isArray(operationOrOperations) ? operationOrOperations : [operationOrOperations];
  const edited = editTimelineBatch(timeline, operations);
  const changes = [];
  const beforeTracks = new Map(timeline.tracks.map((track) => [track.id, track]));
  const afterTracks = new Map(edited.tracks.map((track) => [track.id, track]));

  for (const trackId of new Set([...beforeTracks.keys(), ...afterTracks.keys()])) {
    const beforeTrack = beforeTracks.get(trackId);
    const afterTrack = afterTracks.get(trackId);
    const beforeMetadata = beforeTrack && withoutClips(beforeTrack);
    const afterMetadata = afterTrack && withoutClips(afterTrack);
    if (!isDeepStrictEqual(beforeMetadata, afterMetadata)) {
      changes.push({ entity: 'track', change: beforeTrack ? (afterTrack ? 'updated' : 'removed') : 'added', trackId, before: beforeMetadata ?? null, after: afterMetadata ?? null });
    }

    const beforeClips = new Map((beforeTrack?.clips ?? []).map((clip) => [clip.id, clip]));
    const afterClips = new Map((afterTrack?.clips ?? []).map((clip) => [clip.id, clip]));
    for (const clipId of new Set([...beforeClips.keys(), ...afterClips.keys()])) {
      const before = beforeClips.get(clipId);
      const after = afterClips.get(clipId);
      if (!isDeepStrictEqual(before, after)) {
        changes.push({ entity: 'clip', change: before ? (after ? 'updated' : 'removed') : 'added', trackId, clipId, before: before ?? null, after: after ?? null });
      }
    }
  }

  return {
    schemaVersion: 1,
    operationCount: operations.length,
    durationBeforeSeconds: timeline.project.durationSeconds,
    durationAfterSeconds: edited.project.durationSeconds,
    durationDeltaSeconds: edited.project.durationSeconds - timeline.project.durationSeconds,
    changes,
  };
}

function withoutClips(track) {
  const { clips, ...metadata } = track;
  return metadata;
}

function sliceTimelineClip(clip, kind, localStart, localEnd, timelineStart) {
  const durationSeconds = localEnd - localStart;
  if (durationSeconds <= 1e-9) return undefined;
  const segment = structuredClone(clip);
  const originalDuration = clip.durationSeconds;
  segment.timelineStart = timelineStart;
  segment.durationSeconds = durationSeconds;
  const keyframes = sliceVisualKeyframes(clip.keyframes, localStart, localEnd);
  if (keyframes) segment.keyframes = keyframes;
  else delete segment.keyframes;
  const volumeKeyframes = sliceAudioVolumeKeyframes(clip.volumeKeyframes, localStart, localEnd);
  if (volumeKeyframes) segment.volumeKeyframes = volumeKeyframes;
  else delete segment.volumeKeyframes;

  if (kind !== 'overlay') {
    const sourceStartOffset = clip.speedRamp
      ? speedRampSourceAtTime(clip.speedRamp, localStart)
      : localStart * (clip.playbackRate ?? 1);
    const sourceEndOffset = clip.speedRamp
      ? speedRampSourceAtTime(clip.speedRamp, localEnd)
      : localEnd * (clip.playbackRate ?? 1);
    segment.sourceIn = clip.reverse ? clip.sourceOut - sourceEndOffset : clip.sourceIn + sourceStartOffset;
    segment.sourceOut = clip.reverse ? clip.sourceOut - sourceStartOffset : clip.sourceIn + sourceEndOffset;
    if (clip.speedRamp) segment.speedRamp = sliceSpeedRamp(clip.speedRamp, sourceStartOffset, sourceEndOffset);
  }

  if (clip.wordTimings) {
    const words = clip.wordTimings.flatMap((word) => {
      const start = Math.max(word.start, localStart);
      const end = Math.min(word.end, localEnd);
      return end > start ? [{ text: word.text, start: start - localStart, end: end - localStart }] : [];
    });
    if (!words.length) return undefined;
    segment.wordTimings = words;
    segment.text = words.map((word) => word.text).join(' ');
  }

  if (localStart > 0) {
    delete segment.fadeInSeconds;
    delete segment.transitionIn;
  }
  if (localEnd < originalDuration) {
    delete segment.fadeOutSeconds;
    delete segment.transitionOut;
  }
  if (segment.fadeInSeconds !== undefined) segment.fadeInSeconds = Math.min(segment.fadeInSeconds, durationSeconds);
  if (segment.fadeOutSeconds !== undefined) segment.fadeOutSeconds = Math.min(segment.fadeOutSeconds, durationSeconds - (segment.fadeInSeconds ?? 0));
  return segment;
}

function uniqueRippleClipId(baseId, usedIds) {
  let index = 1;
  let id = `${baseId}-ripple-right`;
  while (usedIds.has(id)) id = `${baseId}-ripple-right-${++index}`;
  usedIds.add(id);
  return id;
}

function findClip(timeline, trackId, clipId) {
  return findClipEntry(timeline, trackId, clipId).clip;
}

function findClipEntry(timeline, trackId, clipId) {
  validateTimeline(timeline);
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  assertTrackEditable(track);
  const index = track.clips.findIndex((candidate) => candidate.id === clipId);
  if (index < 0) throw new TypeError(`Unknown clip ${clipId} on track ${trackId}.`);
  return { track, clip: track.clips[index], index };
}

function assertTrackEditable(track) {
  if (track.locked === true) throw new TypeError(`Track ${track.id} is locked. Unlock it before editing its clips or track settings.`);
}
