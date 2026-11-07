import { validateTimeline } from './validate.mjs';

/** Return a compact, deterministic editing overview for agents and review tools. */
export function inspectTimeline(timeline) {
  validateTimeline(timeline);
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const tracks = [...timeline.tracks]
    .sort((left, right) => left.order - right.order)
    .map((track) => {
      const clips = [...track.clips]
        .sort((left, right) => left.timelineStart - right.timelineStart
          || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map((clip) => inspectClip(track, clip, assets.get(clip.assetId)));
      return {
        id: track.id,
        kind: track.kind,
        order: track.order,
        ...(track.name === undefined ? {} : { name: track.name }),
        ...(track.visible === undefined ? {} : { visible: track.visible }),
        ...(track.muted === undefined ? {} : { muted: track.muted }),
        ...(track.solo === undefined ? {} : { solo: track.solo }),
        ...(track.locked === undefined ? {} : { locked: track.locked }),
        ...(track.volume === undefined ? {} : { volume: track.volume }),
        ...(track.volumeKeyframes === undefined ? {} : { volumeKeyframes: structuredClone(track.volumeKeyframes) }),
        ...(track.audioEffects === undefined ? {} : { audioEffects: structuredClone(track.audioEffects) }),
        ...(track.allowOverlap === undefined ? {} : { allowOverlap: track.allowOverlap }),
        clipCount: clips.length,
        clips,
      };
    });

  const clipCounts = Object.fromEntries(['video', 'audio', 'overlay'].map((kind) => [
    kind,
    tracks.filter((track) => track.kind === kind).reduce((total, track) => total + track.clipCount, 0),
  ]));
  return {
    schemaVersion: 1,
    project: {
      id: timeline.project.id,
      width: timeline.project.width,
      height: timeline.project.height,
      fps: timeline.project.fps,
      durationSeconds: timeline.project.durationSeconds,
      ...(timeline.project.sourceFit === undefined ? {} : { sourceFit: timeline.project.sourceFit }),
      ...(timeline.project.backgroundColor === undefined ? {} : { backgroundColor: timeline.project.backgroundColor }),
    },
    ...(timeline.audioMix === undefined ? {} : { audioMix: structuredClone(timeline.audioMix) }),
    ...(timeline.audioMastering === undefined ? {} : { audioMastering: structuredClone(timeline.audioMastering) }),
    ...(timeline.lineage === undefined ? {} : { lineage: structuredClone(timeline.lineage) }),
    markers: [...(timeline.markers ?? [])]
      .sort((left, right) => left.timeSeconds - right.timeSeconds || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((marker) => structuredClone(marker)),
    summary: {
      assetCount: timeline.assets.length,
      trackCount: tracks.length,
      clipCount: Object.values(clipCounts).reduce((total, count) => total + count, 0),
      clipCounts,
      markerCount: timeline.markers?.length ?? 0,
    },
    assets: timeline.assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      ...(asset.type === undefined ? {} : { type: asset.type }),
      ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
      ...(asset.frameRate === undefined ? {} : { frameRate: asset.frameRate }),
      ...(asset.hasAudio === undefined ? {} : { hasAudio: asset.hasAudio }),
      ...(asset.videoStreams === undefined ? {} : { videoStreams: structuredClone(asset.videoStreams) }),
      ...(asset.audioStreams === undefined ? {} : { audioStreams: structuredClone(asset.audioStreams) }),
      ...(asset.streamTiming === undefined ? {} : { streamTiming: structuredClone(asset.streamTiming) }),
      ...(asset.proxies === undefined ? {} : { proxies: structuredClone(asset.proxies) }),
    })),
    tracks,
  };
}

function inspectClip(track, clip, asset) {
  const result = {
    id: clip.id,
    assetId: clip.assetId ?? null,
    ...(clip.enabled === undefined ? {} : { enabled: clip.enabled }),
    mediaType: track.kind === 'overlay' ? (clip.text === undefined ? 'composition' : 'text') : asset?.type ?? track.kind,
    timeline: {
      startSeconds: clip.timelineStart,
      endSeconds: roundInspectionSeconds(clip.timelineStart + clip.durationSeconds),
      durationSeconds: clip.durationSeconds,
    },
  };
  if (track.kind !== 'overlay') {
    result.source = {
      inSeconds: clip.sourceIn,
      outSeconds: clip.sourceOut,
      ...(clip.playbackRate === undefined ? {} : { playbackRate: clip.playbackRate }),
      ...(clip.speedRamp === undefined ? {} : { speedRamp: clip.speedRamp }),
      ...(clip.reverse === undefined ? {} : { reverse: clip.reverse }),
      ...(clip.videoStreamIndex === undefined ? {} : { videoStreamIndex: clip.videoStreamIndex }),
    };
  }
  for (const field of [
    'text', 'x', 'y', 'width', 'height', 'fontFamily', 'fontSize', 'fontWeight',
    'lineHeight', 'verticalAlign', 'paddingPixels', 'color', 'backgroundColor',
    'textAlign', 'textOutline', 'textShadow', 'wordTimings', 'wordHighlightColor',
    'wordHighlightAnimation', 'volume', 'fadeInSeconds', 'fadeOutSeconds',
    'audioEffects', 'volumeKeyframes',
    'transitionIn', 'transitionOut', 'blendMode', 'keyframes', 'effects', 'mask',
    'sourceFit',
  ]) {
    if (clip[field] !== undefined) result[field] = structuredClone(clip[field]);
  }
  return result;
}

function roundInspectionSeconds(seconds) {
  return Number(seconds.toFixed(6));
}
