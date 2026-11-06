import { isDeepStrictEqual } from 'node:util';
import { validateTimeline } from './validate.mjs';
import { sliceVisualKeyframes } from './keyframes.mjs';
import { sliceSpeedRamp, speedRampDuration, speedRampSourceAtTime } from './speed-ramp.mjs';
import { validateClipTransition } from './transition.mjs';
import { frameRateNumber } from '../media/frame-rate.mjs';

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
  next.tracks.splice(index, 1);
  return validateTimeline(next);
}

export function addTimelineClip(timeline, trackId, clip) {
  if (!clip || typeof clip !== 'object' || Array.isArray(clip)) throw new TypeError('Timeline clip must be an object.');
  const next = structuredClone(timeline);
  const track = next.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new TypeError(`Unknown timeline track: ${trackId}`);
  if (track.clips.some((candidate) => candidate.id === clip.id)) throw new TypeError(`Timeline clip already exists on track ${trackId}: ${clip.id}`);
  track.clips.push(structuredClone(clip));
  next.project.durationSeconds = Math.max(next.project.durationSeconds, clip.timelineStart + clip.durationSeconds);
  return validateTimeline(next);
}

export function detachAudioFromTimelineClip(timeline, videoTrackId, videoClipId, audioTrackId, audioClipId, audioStreamIndex) {
  if (!/^[a-z][a-z0-9-]*$/.test(audioTrackId ?? '') || !/^[a-z][a-z0-9-]*$/.test(audioClipId ?? '')) {
    throw new TypeError('Detached audio track and clip ids must be kebab-case ids.');
  }
  const next = structuredClone(timeline);
  const videoTrack = next.tracks.find((track) => track.id === videoTrackId);
  if (!videoTrack || videoTrack.kind !== 'video') throw new TypeError(`Unknown video track: ${videoTrackId}`);
  const videoClip = videoTrack.clips.find((clip) => clip.id === videoClipId);
  if (!videoClip) throw new TypeError(`Unknown clip ${videoClipId} on track ${videoTrackId}.`);
  const asset = next.assets.find((item) => item.id === videoClip.assetId);
  if (asset?.type === 'image' || asset?.hasAudio === false) {
    throw new TypeError(`Video clip ${videoClipId} references media without an audio stream.`);
  }

  let audioTrack = next.tracks.find((track) => track.id === audioTrackId);
  if (audioTrack && audioTrack.kind !== 'audio') throw new TypeError(`Track ${audioTrackId} is not an audio track.`);
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
  const cutStart = target.timelineStart;
  const cutEnd = cutStart + target.durationSeconds;
  const cutDuration = target.durationSeconds;
  const next = structuredClone(timeline);
  const usedIds = new Set(next.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));

  for (const track of next.tracks) {
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

  const next = structuredClone(timeline);
  const usedIds = new Set(next.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  for (const track of next.tracks) {
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

export function moveTimelineClip(timeline, trackId, clipId, timelineStart) {
  if (!Number.isFinite(timelineStart) || timelineStart < 0) throw new TypeError('timelineStart must be a non-negative number.');
  const next = structuredClone(timeline);
  const clip = findClip(next, trackId, clipId);
  clip.timelineStart = timelineStart;
  next.project.durationSeconds = Math.max(next.project.durationSeconds, timelineStart + clip.durationSeconds);
  return validateTimeline(next);
}

export function trimTimelineClip(timeline, trackId, clipId, sourceIn, sourceOut) {
  if (!Number.isFinite(sourceIn) || !Number.isFinite(sourceOut)) throw new TypeError('Trim source bounds must be finite numbers.');
  const next = structuredClone(timeline);
  const { track, clip } = findClipEntry(next, trackId, clipId);
  if (track.kind === 'overlay') throw new TypeError('Overlay clips cannot be source-trimmed.');
  if (sourceIn < clip.sourceIn || sourceOut > clip.sourceOut || sourceOut <= sourceIn) throw new TypeError('Trim bounds must be a positive subrange of the existing source range.');
  const sourceOffset = sourceIn - clip.sourceIn;
  const sourceEndOffset = sourceOut - clip.sourceIn;
  const trimBefore = clip.speedRamp
    ? speedRampDuration(clip.speedRamp, 0, sourceOffset)
    : sourceOffset / (clip.playbackRate ?? 1);
  const durationSeconds = clip.speedRamp
    ? speedRampDuration(clip.speedRamp, sourceOffset, sourceEndOffset)
    : (sourceOut - sourceIn) / (clip.playbackRate ?? 1);
  clip.keyframes = sliceVisualKeyframes(clip.keyframes, trimBefore, trimBefore + durationSeconds);
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
  const originalSpeedRamp = clip.speedRamp;
  const sourceSplit = clip.sourceIn + (originalSpeedRamp
    ? speedRampSourceAtTime(originalSpeedRamp, splitOffset)
    : splitOffset * (clip.playbackRate ?? 1));
  const originalEnd = clip.sourceOut;
  const originalFadeOut = clip.fadeOutSeconds ?? 0;
  const originalFadeIn = clip.fadeInSeconds ?? 0;
  const originalTransitionOut = clip.transitionOut;
  clip.sourceOut = sourceSplit;
  clip.durationSeconds = splitOffset;
  clip.keyframes = sliceVisualKeyframes(originalKeyframes, 0, splitOffset);
  if (originalSpeedRamp) clip.speedRamp = sliceSpeedRamp(originalSpeedRamp, 0, sourceSplit - clip.sourceIn);
  clip.fadeInSeconds = Math.min(originalFadeIn, splitOffset);
  clip.fadeOutSeconds = 0;
  delete clip.transitionOut;
  const right = {
    ...clip,
    id: rightClipId,
    sourceIn: sourceSplit,
    sourceOut: originalEnd,
    timelineStart: splitAt,
    durationSeconds: originalDuration - splitOffset,
    keyframes: sliceVisualKeyframes(originalKeyframes, splitOffset, originalDuration),
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

export function editTimeline(timeline, operation) {
  if (!operation || typeof operation !== 'object') throw new TypeError('Timeline edit operation must be an object.');
  const { type, trackId, clipId } = operation;
  if (type === 'add-track') return addTimelineTrack(timeline, operation.track);
  if (type === 'remove-track') return removeTimelineTrack(timeline, operation.trackId);
  if (type === 'add-clip') return addTimelineClip(timeline, trackId, operation.clip);
  if (type === 'detach-audio') return detachAudioFromTimelineClip(timeline, trackId, clipId, operation.audioTrackId, operation.audioClipId, operation.audioStreamIndex);
  if (type === 'remove-clip') return removeTimelineClip(timeline, trackId, clipId);
  if (type === 'ripple-delete') return rippleDeleteTimelineClip(timeline, trackId, clipId);
  if (type === 'insert-gap') return insertTimelineGap(timeline, operation.timelineStart, operation.durationSeconds);
  if (type === 'move') return moveTimelineClip(timeline, trackId, clipId, operation.timelineStart);
  if (type === 'trim') return trimTimelineClip(timeline, trackId, clipId, operation.sourceIn, operation.sourceOut);
  if (type === 'slip') return slipTimelineClip(timeline, trackId, clipId, operation.sourceDelta);
  if (type === 'split') return splitTimelineClip(timeline, trackId, clipId, operation.splitAt, operation.rightClipId);
  if (type === 'crossfade') return crossfadeTimelineClips(timeline, trackId, clipId, operation.incomingClipId, operation.durationSeconds);
  if (type === 'transition') return setTimelineTransition(timeline, trackId, clipId, operation.edge, operation.transition);
  throw new TypeError('Timeline edit type must be add-track, remove-track, add-clip, detach-audio, remove-clip, ripple-delete, insert-gap, move, trim, slip, split, crossfade, or transition.');
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

  if (kind !== 'overlay') {
    const sourceStartOffset = clip.speedRamp
      ? speedRampSourceAtTime(clip.speedRamp, localStart)
      : localStart * (clip.playbackRate ?? 1);
    const sourceEndOffset = clip.speedRamp
      ? speedRampSourceAtTime(clip.speedRamp, localEnd)
      : localEnd * (clip.playbackRate ?? 1);
    segment.sourceIn = clip.sourceIn + sourceStartOffset;
    segment.sourceOut = clip.sourceIn + sourceEndOffset;
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
  const index = track.clips.findIndex((candidate) => candidate.id === clipId);
  if (index < 0) throw new TypeError(`Unknown clip ${clipId} on track ${trackId}.`);
  return { track, clip: track.clips[index], index };
}
