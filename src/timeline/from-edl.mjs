import { assertEdlApproved, validateEdl } from '../edits/retime-transcript.mjs';
import { validateTimeline } from './validate.mjs';

export function timelineFromEdl(edl, assetId, project = {}) {
  validateEdl(edl, edl?.sourceDurationSeconds);
  assertEdlApproved(edl);
  if (!/^[a-z][a-z0-9-]*$/.test(assetId ?? '')) throw new TypeError('assetId must be a kebab-case id.');
  const cuts = edl.cuts;
  const clips = [];
  let source = 0, timeline = 0;
  for (let i = 0; i <= cuts.length; i++) {
    const end = cuts[i]?.sourceStart ?? edl.sourceDurationSeconds;
    if (end > source) {
      const durationSeconds = end - source;
      clips.push({ id: `clip-${clips.length + 1}`, assetId, sourceIn: source, sourceOut: end, timelineStart: timeline, durationSeconds });
      timeline += durationSeconds;
    }
    if (cuts[i]) source = cuts[i].sourceEnd;
  }
  const tracks = [{ id: 'video-main', kind: 'video', order: 0, clips }];
  if (project.includeAudioTrack) {
    tracks.push({
      id: 'audio-main',
      kind: 'audio',
      order: 1,
      clips: clips.map((clip, index) => ({ ...clip, id: `audio-clip-${index + 1}` })),
    });
  }
  const result = { schemaVersion: 1, project: { id: project.id ?? 'edited-video', width: project.width ?? 1920, height: project.height ?? 1080, fps: project.fps ?? 30, durationSeconds: timeline, ...(project.sourceFit === undefined ? {} : { sourceFit: project.sourceFit }) }, assets: [{ id: assetId, path: project.assetPath ?? 'assets/source.mp4', ...(project.assetType ? { type: project.assetType } : {}), ...(project.assetHasAudio !== undefined ? { hasAudio: project.assetHasAudio } : {}), ...(project.assetVideoStreams !== undefined ? { videoStreams: project.assetVideoStreams } : {}), ...(project.assetAudioStreams !== undefined ? { audioStreams: project.assetAudioStreams } : {}), ...(project.assetDurationSeconds !== undefined ? { durationSeconds: project.assetDurationSeconds } : {}), ...(project.assetStreamTiming !== undefined ? { streamTiming: project.assetStreamTiming } : {}) }], tracks };
  return validateTimeline(result);
}
