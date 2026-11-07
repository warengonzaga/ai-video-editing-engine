import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { retimeTranscript, validateEdl } from '../edits/retime-transcript.mjs';
import { createCaptionTrack } from './captions.mjs';
import { timelineFromEdl } from './from-edl.mjs';
import { renderTimeline, renderTimelineAsync } from './render.mjs';
import { validateTimeline } from './validate.mjs';

export function assembleEditedTimeline(projectPath, assetId, transcript, edl, options = {}) {
  const root = resolve(projectPath);
  const meta = readProjectMeta(root);
  const manifest = JSON.parse(readFileSync(join(root, 'assets', 'manifest.json'), 'utf8'));
  const asset = manifest.assets.find((entry) => entry.id === assetId);
  if (!asset) throw new TypeError(`Asset is not registered in this project: ${assetId}`);
  if (asset.type !== 'video') throw new TypeError('Transcript-driven editing requires a registered video asset.');
  validateEdl(edl, asset.durationSeconds);
  if (Math.abs(transcript.durationSeconds - asset.durationSeconds) > 1e-6) throw new TypeError('Transcript duration must match the registered source media.');

  const retimedTranscript = retimeTranscript(transcript, edl);
  const timeline = timelineFromEdl(edl, assetId, {
    id: meta.id,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    sourceFit: meta.sourceFit,
    backgroundColor: meta.backgroundColor,
    assetPath: asset.path,
    assetType: asset.type,
    assetHasAudio: asset.hasAudio,
    assetAudioStreams: asset.audioStreams,
    assetDurationSeconds: asset.durationSeconds,
    assetStreamTiming: asset.streamTiming,
    includeAudioTrack: asset.hasAudio,
  });
  if (Math.abs(retimedTranscript.durationSeconds - timeline.project.durationSeconds) > 1e-6) throw new Error('Retimed transcript and edit timeline durations do not match.');
  const captionOptions = { ...options.captionOptions, order: timeline.tracks.length };
  if (captionOptions.fontSize === undefined) captionOptions.fontSize = Math.max(8, Math.round(54 * Math.min(meta.width, meta.height) / 1080));
  const captions = createCaptionTrack(retimedTranscript, captionOptions);
  timeline.tracks.push(captions);
  timeline.lineage = {
    assetId,
    sourceSha256: asset.sha256,
    approvedEdl: 'edits/approved-edl.json',
    retimedTranscript: 'transcripts/retimed-transcript.json',
  };
  validateTimeline(timeline);
  return { timeline, retimedTranscript, asset };
}

export function renderEditedProject(projectPath, assetId, transcript, edl, options = {}) {
  if (options.signal !== undefined || options.timeoutSeconds !== undefined || options.onProgress !== undefined) {
    throw new TypeError('Cancellation, timeouts, and progress callbacks require renderEditedProjectAsync.');
  }
  return renderEditedProjectWith(projectPath, assetId, transcript, edl, options, renderTimeline);
}

export function renderEditedProjectAsync(projectPath, assetId, transcript, edl, options = {}) {
  return renderEditedProjectWith(projectPath, assetId, transcript, edl, options, renderTimelineAsync);
}

function renderEditedProjectWith(projectPath, assetId, transcript, edl, options, renderTimelineFunction) {
  const root = resolve(projectPath);
  const metaPath = join(root, 'meta.json');
  const indexPath = join(root, 'index.html');
  const timelinePath = join(root, 'timeline.json');
  const approvedEdlPath = join(root, 'edits', 'approved-edl.json');
  const retimedTranscriptPath = join(root, 'transcripts', 'retimed-transcript.json');
  const outputPath = resolve(options.outputPath ?? join(root, 'renders', 'final.mp4'));
  for (const path of [timelinePath, approvedEdlPath, retimedTranscriptPath, outputPath]) {
    if (existsSync(path)) throw new Error(`End-to-end edit would overwrite existing project data: ${path}`);
  }

  const { timeline, retimedTranscript } = assembleEditedTimeline(root, assetId, transcript, edl, options);
  const originalMeta = readFileSync(metaPath, 'utf8');
  const originalHtml = readFileSync(indexPath);
  const nextMeta = { ...JSON.parse(originalMeta), durationSeconds: timeline.project.durationSeconds };
  const renderOptions = Object.fromEntries(
    ['format', 'encoder', 'colorProfile', 'workers', 'lowMemoryMode', 'timeoutSeconds', 'signal', 'onProgress']
      .filter((field) => options[field] !== undefined)
      .map((field) => [field, options[field]]),
  );
  let wroteEdl = false;
  let wroteTranscript = false;
  try {
    writeFileSync(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`);
    writeFileSync(approvedEdlPath, `${JSON.stringify(edl, null, 2)}\n`, { flag: 'wx' });
    wroteEdl = true;
    writeFileSync(retimedTranscriptPath, `${JSON.stringify(retimedTranscript, null, 2)}\n`, { flag: 'wx' });
    wroteTranscript = true;
    const render = renderTimelineFunction(root, timeline, outputPath, options.quality ?? 'draft', renderOptions);
    if (render && typeof render.then === 'function') {
      return render.then((result) => ({ ...result, assetId, timelinePath, approvedEdlPath, retimedTranscriptPath }))
        .catch((error) => {
          restoreEditedProject({ metaPath, originalMeta, indexPath, originalHtml, approvedEdlPath, retimedTranscriptPath, timelinePath, wroteEdl, wroteTranscript });
          throw error;
        });
    }
    return { ...render, assetId, timelinePath, approvedEdlPath, retimedTranscriptPath };
  } catch (error) {
    restoreEditedProject({ metaPath, originalMeta, indexPath, originalHtml, approvedEdlPath, retimedTranscriptPath, timelinePath, wroteEdl, wroteTranscript });
    throw error;
  }
}

function restoreEditedProject({ metaPath, originalMeta, indexPath, originalHtml, approvedEdlPath, retimedTranscriptPath, timelinePath, wroteEdl, wroteTranscript }) {
  writeFileSync(metaPath, originalMeta);
  writeFileSync(indexPath, originalHtml);
  if (wroteEdl) unlinkSync(approvedEdlPath);
  if (wroteTranscript) unlinkSync(retimedTranscriptPath);
  if (existsSync(timelinePath)) {
    try { unlinkSync(timelinePath); } catch {}
  }
}

function readProjectMeta(root) {
  const path = join(root, 'meta.json');
  if (!existsSync(path)) throw new Error(`Not an Engine project: ${root}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}
