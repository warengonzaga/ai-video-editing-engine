import { validateSourceFit } from './source-fit.mjs';
import { validateAudioMix } from './audio-mix.mjs';
import { frameRateNumber } from '../media/frame-rate.mjs';
import { validateVisualKeyframes } from './keyframes.mjs';
import { validateAudioMastering } from './audio-mastering.mjs';
import { validateVisualMask } from './mask.mjs';
import { validateSpeedRamp } from './speed-ramp.mjs';
import { validateClipTransition } from './transition.mjs';
import { validateBlendMode } from './blend-mode.mjs';

const TRACK_KINDS = new Set(['video', 'audio', 'overlay']);

export function validateTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline) || timeline.schemaVersion !== 1) throw new TypeError('Timeline must be an object with schemaVersion 1.');
  const project = timeline.project;
  if (!project || typeof project !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id ?? '')) throw new TypeError('Timeline project needs a kebab-case id.');
  for (const field of ['width', 'height']) if (!Number.isSafeInteger(project[field]) || project[field] <= 0) throw new TypeError(`Timeline project ${field} must be a positive integer.`);
  frameRateNumber(project.fps);
  if (!Number.isFinite(project.durationSeconds) || project.durationSeconds <= 0) throw new TypeError('Timeline project durationSeconds must be positive.');
  validateSourceFit(project.sourceFit, 'Timeline project sourceFit');
  if (!Array.isArray(timeline.assets) || !Array.isArray(timeline.tracks)) throw new TypeError('Timeline assets and tracks must be arrays.');

  const assets = new Set();
  for (const asset of timeline.assets) {
    if (!asset || !/^[a-z][a-z0-9-]*$/.test(asset.id ?? '') || assets.has(asset.id)) throw new TypeError('Timeline asset ids must be unique kebab-case ids.');
    if (typeof asset.path !== 'string' || !asset.path.trim() || asset.path.startsWith('/') || /^[a-z]:[\\/]/i.test(asset.path) || asset.path.split(/[\\/]/).includes('..')) throw new TypeError(`Asset ${asset.id} needs a project-relative path without traversal.`);
    if (asset.type !== undefined && !['video', 'audio', 'image'].includes(asset.type)) throw new TypeError(`Asset ${asset.id} has an unsupported media type.`);
    if (asset.hasAudio !== undefined && typeof asset.hasAudio !== 'boolean') throw new TypeError(`Asset ${asset.id} has invalid audio metadata.`);
    if (asset.audioStreams !== undefined) validateAudioStreams(asset.audioStreams, asset.id);
    if (asset.durationSeconds !== undefined && (!Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0)) throw new TypeError(`Asset ${asset.id} durationSeconds must be positive.`);
    if (asset.streamTiming !== undefined) validateStreamTiming(asset.streamTiming, asset.id);
    assets.add(asset.id);
  }

  const trackIds = new Set();
  const trackOrders = new Set();
  for (const track of timeline.tracks) {
    if (!track || !/^[a-z][a-z0-9-]*$/.test(track.id ?? '') || trackIds.has(track.id)) throw new TypeError('Timeline track ids must be unique kebab-case ids.');
    if (!TRACK_KINDS.has(track.kind) || !Number.isSafeInteger(track.order) || track.order < 0 || !Array.isArray(track.clips)) throw new TypeError(`Track ${track.id} has invalid kind, order, or clips.`);
    if (trackOrders.has(track.order)) throw new TypeError(`Timeline track order ${track.order} is used more than once.`);
    if (track.muted !== undefined && (track.kind !== 'audio' || typeof track.muted !== 'boolean')) throw new TypeError(`Track ${track.id} muted must be a boolean on an audio track.`);
    if (track.visible !== undefined && ((track.kind !== 'video' && track.kind !== 'overlay') || typeof track.visible !== 'boolean')) throw new TypeError(`Track ${track.id} visible must be a boolean on a video or overlay track.`);
    if (track.allowOverlap !== undefined && typeof track.allowOverlap !== 'boolean') throw new TypeError(`Track ${track.id} allowOverlap must be a boolean.`);
    if (track.volume !== undefined && (track.kind !== 'audio' || !Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1)) throw new TypeError(`Track ${track.id} volume must be between 0 and 1 on an audio track.`);
    trackIds.add(track.id);
    trackOrders.add(track.order);
    const clipIds = new Set();
    const clips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    let previousEnd = 0;
    for (const clip of clips) {
      if (!clip || !/^[a-z][a-z0-9-]*$/.test(clip.id ?? '') || clipIds.has(clip.id)) throw new TypeError(`Track ${track.id} clip ids must be unique kebab-case ids.`);
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.timelineStart) || clip.timelineStart < 0 || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0 || clip.timelineStart + clip.durationSeconds > project.durationSeconds + 1e-6) throw new TypeError(`Clip ${clip.id} has invalid timeline bounds.`);
      if (track.kind === 'overlay') {
        const hasComposition = typeof clip.composition === 'string' && clip.composition.trim();
        const hasText = typeof clip.text === 'string' && clip.text.trim();
        if (Boolean(hasComposition) === Boolean(hasText)) throw new TypeError(`Overlay ${clip.id} must define either a composition or text.`);
        if (hasText) validateTextClip(clip);
      } else if (!assets.has(clip.assetId)) throw new TypeError(`Clip ${clip.id} is missing its asset for the ${track.kind} track.`);
      const assetRecord = timeline.assets.find((item) => item.id === clip.assetId);
      if (track.kind === 'video' && assetRecord?.type === 'audio') throw new TypeError(`Video clip ${clip.id} references an audio-only asset.`);
      if (track.kind === 'audio' && assetRecord?.type === 'image') throw new TypeError(`Audio clip ${clip.id} references an image asset.`);
      if (track.kind === 'audio' && assetRecord?.type === 'video' && assetRecord.hasAudio === false) throw new TypeError(`Audio clip ${clip.id} references a video asset without audio.`);
      if (clip.audioStreamIndex !== undefined) {
        if (track.kind !== 'audio' || !Number.isSafeInteger(clip.audioStreamIndex) || clip.audioStreamIndex < 0) {
          throw new TypeError(`Clip ${clip.id} audioStreamIndex must be a non-negative integer on an audio track.`);
        }
        if (assetRecord?.audioStreams && clip.audioStreamIndex >= assetRecord.audioStreams.length) {
          throw new TypeError(`Clip ${clip.id} audioStreamIndex exceeds the audio streams in asset ${assetRecord.id}.`);
        }
        if (!assetRecord?.audioStreams && clip.audioStreamIndex > 0) {
          throw new TypeError(`Asset ${assetRecord?.id ?? clip.assetId} has no probed audio stream metadata for index ${clip.audioStreamIndex}.`);
        }
      }
      if (clip.fit !== undefined && track.kind !== 'video') throw new TypeError(`Clip ${clip.id} can set fit only on a video track.`);
      if (track.kind === 'video') {
        validateSourceFit(clip.fit, `Clip ${clip.id} fit`);
        validatePlacement(clip, `Video clip ${clip.id}`);
      }
      if (clip.mask !== undefined) {
        if (track.kind !== 'video' && track.kind !== 'overlay') throw new TypeError(`Clip ${clip.id} masks are supported on video and overlay tracks.`);
        validateVisualMask(clip.mask, `Clip ${clip.id} mask`);
      }
      validateTransitions(track, clip);
      validateBlendMode(clip, track.kind);
      validateVisualKeyframes(track, clip);
      if (clip.speedRamp !== undefined) {
        if ((track.kind !== 'video' && track.kind !== 'audio')
            || (track.kind === 'video' && assetRecord?.type === 'image')) {
          throw new TypeError(`Clip ${clip.id} speedRamp requires video or audio media.`);
        }
        validateSpeedRamp(clip);
      }
      if (clip.playbackRate !== undefined && (!Number.isFinite(clip.playbackRate) || clip.playbackRate < 0.1 || clip.playbackRate > 5 || track.kind === 'overlay' || (track.kind === 'video' && assetRecord?.type === 'image'))) {
        throw new TypeError(`Clip ${clip.id} playbackRate must be from 0.1 to 5 on video or audio media.`);
      }
      if (clip.volume !== undefined && (track.kind !== 'audio' || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 1)) throw new TypeError(`Clip ${clip.id} volume must be between 0 and 1 on an audio track.`);
      for (const fade of ['fadeInSeconds', 'fadeOutSeconds']) {
        if (clip[fade] !== undefined && (!Number.isFinite(clip[fade]) || clip[fade] < 0 || clip[fade] > clip.durationSeconds)) throw new TypeError(`Clip ${clip.id} ${fade} must be between 0 and its duration.`);
      }
      if ((clip.fadeInSeconds ?? 0) + (clip.fadeOutSeconds ?? 0) > clip.durationSeconds + 1e-6) throw new TypeError(`Clip ${clip.id} fades cannot exceed the clip duration.`);
      if (track.kind !== 'overlay' && (!Number.isFinite(clip.sourceIn) || !Number.isFinite(clip.sourceOut) || clip.sourceIn < 0 || clip.sourceOut <= clip.sourceIn || (clip.speedRamp === undefined && Math.abs(clip.sourceOut - clip.sourceIn - clip.durationSeconds * (clip.playbackRate ?? 1)) > 1e-6))) throw new TypeError(`Clip ${clip.id} source range must match its timeline duration multiplied by playbackRate.`);
      if (track.kind !== 'overlay' && Number.isFinite(assetRecord?.durationSeconds) && clip.sourceOut > assetRecord.durationSeconds + 1e-6) throw new TypeError(`Clip ${clip.id} sourceOut exceeds asset ${assetRecord.id} duration.`);
      if (!track.allowOverlap && clip.timelineStart < previousEnd - 1e-6) throw new TypeError(`Track ${track.id} contains overlapping clips; set allowOverlap to true to permit them.`);
      previousEnd = clip.timelineStart + clip.durationSeconds;
    }
  }
  validateAudioMix(timeline);
  validateAudioMastering(timeline);
  return timeline;
}

function validateTransitions(track, clip) {
  const transitions = ['transitionIn', 'transitionOut'].filter((field) => clip[field] !== undefined);
  if (transitions.length === 0) return;
  if (track.kind !== 'video' && track.kind !== 'overlay') throw new TypeError(`Clip ${clip.id} transitions are supported on video and overlay tracks.`);
  for (const field of transitions) validateClipTransition(clip[field], clip, `Clip ${clip.id} ${field}`);
  const incoming = clip.transitionIn;
  const outgoing = clip.transitionOut;
  if ((incoming?.durationSeconds ?? 0) + (outgoing?.durationSeconds ?? 0) > clip.durationSeconds + 1e-6) {
    throw new TypeError(`Clip ${clip.id} transition durations cannot overlap.`);
  }
  if (clip.mask && [incoming, outgoing].some((transition) => transition?.type === 'wipe')) {
    throw new TypeError(`Clip ${clip.id} wipe transitions cannot be combined with a static mask.`);
  }
  if (incoming?.type === 'wipe' && outgoing?.type === 'wipe' && incoming.direction !== outgoing.direction) {
    throw new TypeError(`Clip ${clip.id} wipe transitions must use the same direction.`);
  }
  const usesOpacity = clip.keyframes?.some((frame) => frame.properties.opacity !== undefined);
  if (usesOpacity && [incoming, outgoing].some((transition) => transition?.type === 'fade')) {
    throw new TypeError(`Clip ${clip.id} fade transitions cannot be combined with opacity keyframes.`);
  }
  if (incoming?.type === 'fade' && (clip.fadeInSeconds ?? 0) > 0) {
    throw new TypeError(`Clip ${clip.id} fade-in transition cannot be combined with fadeInSeconds.`);
  }
  if (outgoing?.type === 'fade' && (clip.fadeOutSeconds ?? 0) > 0) {
    throw new TypeError(`Clip ${clip.id} fade-out transition cannot be combined with fadeOutSeconds.`);
  }
}

function validateStreamTiming(timing, assetId) {
  if (!timing || typeof timing !== 'object' || Array.isArray(timing)) throw new TypeError(`Asset ${assetId} streamTiming must be an object.`);
  for (const field of ['containerStartSeconds', 'videoStartSeconds', 'videoDurationSeconds', 'audioStartSeconds', 'audioDurationSeconds']) {
    if (timing[field] !== undefined && timing[field] !== null && !Number.isFinite(timing[field])) throw new TypeError(`Asset ${assetId} streamTiming.${field} must be finite or null.`);
  }
  for (const field of ['videoTimeBase', 'audioTimeBase']) {
    if (timing[field] !== undefined && timing[field] !== null && typeof timing[field] !== 'string') throw new TypeError(`Asset ${assetId} streamTiming.${field} must be a string or null.`);
  }
}

function validateAudioStreams(streams, assetId) {
  if (!Array.isArray(streams)) throw new TypeError(`Asset ${assetId} audioStreams must be an array.`);
  for (const [index, stream] of streams.entries()) {
    if (!stream || typeof stream !== 'object' || Array.isArray(stream)
        || stream.index !== index
        || !Number.isSafeInteger(stream.streamIndex) || stream.streamIndex < 0
        || (stream.codec !== null && stream.codec !== undefined && typeof stream.codec !== 'string')
        || (stream.channels !== null && stream.channels !== undefined && (!Number.isSafeInteger(stream.channels) || stream.channels < 1))
        || (stream.channelLayout !== null && stream.channelLayout !== undefined && typeof stream.channelLayout !== 'string')
        || (stream.sampleRate !== null && stream.sampleRate !== undefined && (!Number.isSafeInteger(stream.sampleRate) || stream.sampleRate < 1))
        || (stream.startSeconds !== null && stream.startSeconds !== undefined && !Number.isFinite(stream.startSeconds))
        || (stream.durationSeconds !== null && stream.durationSeconds !== undefined && (!Number.isFinite(stream.durationSeconds) || stream.durationSeconds <= 0))
        || (stream.timeBase !== null && stream.timeBase !== undefined && typeof stream.timeBase !== 'string')
        || (stream.language !== null && stream.language !== undefined && typeof stream.language !== 'string')
        || (stream.title !== null && stream.title !== undefined && typeof stream.title !== 'string')) {
      throw new TypeError(`Asset ${assetId} audio stream ${index} has invalid metadata.`);
    }
  }
}

function validateTextClip(clip) {
  const position = { x: clip.x ?? 0.08, y: clip.y ?? 0.76, width: clip.width ?? 0.84, height: clip.height ?? 0.16 };
  if (!Object.values(position).every(Number.isFinite) || position.x < 0 || position.y < 0 || position.width <= 0 || position.height <= 0 || position.x + position.width > 1 || position.y + position.height > 1) throw new TypeError(`Text overlay ${clip.id} has invalid normalized placement.`);
  if (clip.wordWrap !== undefined && typeof clip.wordWrap !== 'boolean') throw new TypeError(`Text overlay ${clip.id} wordWrap must be a boolean.`);
  if (clip.wordsPerLine !== undefined && (!Number.isSafeInteger(clip.wordsPerLine) || clip.wordsPerLine < 1 || clip.wordsPerLine > 20)) throw new TypeError(`Text overlay ${clip.id} wordsPerLine must be an integer from 1 to 20.`);
  if (clip.wordTimings !== undefined) {
    if (!Array.isArray(clip.wordTimings) || clip.wordTimings.length === 0) throw new TypeError(`Text overlay ${clip.id} wordTimings must be a non-empty array.`);
    let previousStart = -Infinity;
    for (const [index, word] of clip.wordTimings.entries()) {
      if (!word || typeof word !== 'object' || Array.isArray(word)
          || Object.keys(word).some((field) => !['text', 'start', 'end'].includes(field))
          || typeof word.text !== 'string' || !word.text.trim()
          || !Number.isFinite(word.start) || !Number.isFinite(word.end)
          || word.start < 0 || word.end <= word.start || word.end > clip.durationSeconds + 1e-6
          || word.start < previousStart) {
        throw new TypeError(`Text overlay ${clip.id} wordTimings entry ${index + 1} is invalid.`);
      }
      previousStart = word.start;
    }
    if (clip.wordTimings.map((word) => word.text).join(' ') !== clip.text) throw new TypeError(`Text overlay ${clip.id} wordTimings text must match its caption text.`);
    if (typeof clip.wordHighlightColor !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(clip.wordHighlightColor)) {
      throw new TypeError(`Text overlay ${clip.id} wordHighlightColor must be a hex color.`);
    }
    if (clip.wordHighlightAnimation !== undefined && !['scale', 'pop'].includes(clip.wordHighlightAnimation)) {
      throw new TypeError(`Text overlay ${clip.id} wordHighlightAnimation must be scale or pop.`);
    }
  } else if (clip.wordHighlightColor !== undefined || clip.wordHighlightAnimation !== undefined) {
    throw new TypeError(`Text overlay ${clip.id} word highlighting options require wordTimings.`);
  }
  if (clip.fontSize !== undefined && (!Number.isSafeInteger(clip.fontSize) || clip.fontSize < 8 || clip.fontSize > 256)) throw new TypeError(`Text overlay ${clip.id} fontSize must be an integer from 8 to 256.`);
  if (clip.fontFamily !== undefined && (typeof clip.fontFamily !== 'string' || !/^[\w ,'-]{1,80}$/.test(clip.fontFamily))) throw new TypeError(`Text overlay ${clip.id} fontFamily contains unsupported characters.`);
  if (clip.fontWeight !== undefined && !['normal', 'bold', 100, 200, 300, 400, 500, 600, 700, 800, 900].includes(clip.fontWeight)) throw new TypeError(`Text overlay ${clip.id} fontWeight must be normal, bold, or a hundred-step weight from 100 to 900.`);
  if (clip.lineHeight !== undefined && (!Number.isFinite(clip.lineHeight) || clip.lineHeight < 0.8 || clip.lineHeight > 2.5)) throw new TypeError(`Text overlay ${clip.id} lineHeight must be from 0.8 to 2.5.`);
  if (clip.verticalAlign !== undefined && !['top', 'center', 'bottom'].includes(clip.verticalAlign)) throw new TypeError(`Text overlay ${clip.id} verticalAlign must be top, center, or bottom.`);
  if (clip.paddingPixels !== undefined && (!Number.isSafeInteger(clip.paddingPixels) || clip.paddingPixels < 0 || clip.paddingPixels > 128)) throw new TypeError(`Text overlay ${clip.id} paddingPixels must be an integer from 0 to 128.`);
  for (const color of ['color', 'backgroundColor']) {
    if (clip[color] !== undefined && clip[color] !== 'transparent' && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(clip[color])) throw new TypeError(`Text overlay ${clip.id} ${color} must be a hex color or transparent.`);
  }
  if (clip.textAlign !== undefined && !['left', 'center', 'right'].includes(clip.textAlign)) throw new TypeError(`Text overlay ${clip.id} textAlign must be left, center, or right.`);
  if (clip.textOutline !== undefined) {
    const outline = clip.textOutline;
    if (!outline || typeof outline !== 'object' || Array.isArray(outline)
        || Object.keys(outline).some((field) => !['color', 'widthPixels'].includes(field))
        || typeof outline.color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(outline.color)
        || !Number.isFinite(outline.widthPixels) || outline.widthPixels <= 0 || outline.widthPixels > 12) {
      throw new TypeError(`Text overlay ${clip.id} textOutline must define a hex color and widthPixels from 0 to 12.`);
    }
  }
  if (clip.textShadow !== undefined) {
    const shadow = clip.textShadow;
    if (!shadow || typeof shadow !== 'object' || Array.isArray(shadow)
        || Object.keys(shadow).some((field) => !['color', 'blurPixels', 'offsetXPixels', 'offsetYPixels'].includes(field))
        || typeof shadow.color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(shadow.color)
        || !Number.isFinite(shadow.blurPixels) || shadow.blurPixels < 0 || shadow.blurPixels > 32
        || !Number.isFinite(shadow.offsetXPixels) || Math.abs(shadow.offsetXPixels) > 32
        || !Number.isFinite(shadow.offsetYPixels) || Math.abs(shadow.offsetYPixels) > 32) {
      throw new TypeError(`Text overlay ${clip.id} textShadow has invalid color or bounds.`);
    }
  }
}

function validatePlacement(clip, label) {
  const x = clip.x ?? 0;
  const y = clip.y ?? 0;
  const width = clip.width ?? 1;
  const height = clip.height ?? 1;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw new TypeError(`${label} placement must fit within normalized canvas bounds.`);
}
