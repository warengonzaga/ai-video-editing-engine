import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../render/process.mjs';
import { resolveAudioSidechainSettings } from './audio-mix.mjs';
import { validateTimeline } from './validate.mjs';

export function applySidechainDuckingProxies(root, timeline, temporaryAssets, renderControl) {
  const rules = timeline.audioMix?.sidechain ?? [];
  if (rules.length === 0) return timeline;

  const next = structuredClone(timeline);
  const startIndex = temporaryAssets.length;
  try {
    const stems = new Map();
    for (const rule of rules) {
      if (!stems.has(rule.sourceTrackId)) {
        const sourceTrack = next.tracks.find((track) => track.id === rule.sourceTrackId);
        stems.set(rule.sourceTrackId, buildTrackStem(root, next, sourceTrack, temporaryAssets, renderControl));
      }
    }

    for (const rule of rules) {
      const settings = resolveAudioSidechainSettings(rule);
      const detector = stems.get(rule.sourceTrackId);
      const targetTrack = next.tracks.find((track) => track.id === rule.targetTrackId);
      for (const clip of targetTrack.clips) {
        const sourceAsset = next.assets.find((asset) => asset.id === clip.assetId);
        const sourcePath = join(root, ...sourceAsset.path.split('/'));
        const id = `sidechain-${targetTrack.id}-${clip.id}-${randomUUID().slice(0, 8)}`;
        const relativePath = `assets/.${id}-${randomUUID()}.wav`;
        const absolutePath = join(root, ...relativePath.split('/'));
        const detectorStart = clip.timelineStart;
        const detectorEnd = detectorStart + clip.durationSeconds;
        const threshold = 10 ** (settings.thresholdDb / 20);
        const filter = [
          `[0:a:0]atrim=start=${clip.sourceIn}:end=${clip.sourceOut},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[target]`,
          `[1:a:0]atrim=start=${detectorStart}:end=${detectorEnd},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[detector]`,
          `[target][detector]sidechaincompress=threshold=${threshold}:ratio=${settings.ratio}:attack=${settings.attackSeconds * 1000}:release=${settings.releaseSeconds * 1000}:makeup=1:detection=rms:link=average,atrim=duration=${clip.durationSeconds}[ducked]`,
        ].join(';');
        temporaryAssets.push(absolutePath);
        runFfmpeg(
          root,
          [
            '-i',
            sourcePath,
            '-i',
            detector.path,
            '-filter_complex',
            filter,
            '-map',
            '[ducked]',
            '-vn',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-c:a',
            'pcm_s16le',
            absolutePath,
          ],
          `Could not apply sidechain compression to clip ${clip.id}`,
          renderControl,
        );
        next.assets.push({
          id,
          path: relativePath,
          type: 'audio',
          hasAudio: true,
          durationSeconds: clip.durationSeconds,
        });
        clip.assetId = id;
        clip.sourceIn = 0;
        clip.sourceOut = clip.durationSeconds;
        delete clip.playbackRate;
        delete clip.speedRamp;
      }
    }
    validateTimeline(next);
    return next;
  } catch (error) {
    for (const asset of temporaryAssets.splice(startIndex)) rmSync(asset, { force: true });
    throw error;
  }
}

export async function applySidechainDuckingProxiesAsync(root, timeline, temporaryAssets, renderControl) {
  const rules = timeline.audioMix?.sidechain ?? [];
  if (rules.length === 0) return timeline;

  const next = structuredClone(timeline);
  const startIndex = temporaryAssets.length;
  try {
    const stems = new Map();
    for (const rule of rules) {
      if (!stems.has(rule.sourceTrackId)) {
        const sourceTrack = next.tracks.find((track) => track.id === rule.sourceTrackId);
        stems.set(
          rule.sourceTrackId,
          await buildTrackStemAsync(root, next, sourceTrack, temporaryAssets, renderControl),
        );
      }
    }

    for (const rule of rules) {
      renderControl?.assertActive();
      const settings = resolveAudioSidechainSettings(rule);
      const detector = stems.get(rule.sourceTrackId);
      const targetTrack = next.tracks.find((track) => track.id === rule.targetTrackId);
      for (const clip of targetTrack.clips) {
        const sourceAsset = next.assets.find((asset) => asset.id === clip.assetId);
        const sourcePath = join(root, ...sourceAsset.path.split('/'));
        const id = `sidechain-${targetTrack.id}-${clip.id}-${randomUUID().slice(0, 8)}`;
        const relativePath = `assets/.${id}-${randomUUID()}.wav`;
        const absolutePath = join(root, ...relativePath.split('/'));
        const detectorStart = clip.timelineStart;
        const detectorEnd = detectorStart + clip.durationSeconds;
        const threshold = 10 ** (settings.thresholdDb / 20);
        const filter = [
          `[0:a:0]atrim=start=${clip.sourceIn}:end=${clip.sourceOut},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[target]`,
          `[1:a:0]atrim=start=${detectorStart}:end=${detectorEnd},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[detector]`,
          `[target][detector]sidechaincompress=threshold=${threshold}:ratio=${settings.ratio}:attack=${settings.attackSeconds * 1000}:release=${settings.releaseSeconds * 1000}:makeup=1:detection=rms:link=average,atrim=duration=${clip.durationSeconds}[ducked]`,
        ].join(';');
        temporaryAssets.push(absolutePath);
        await runSidechainFfmpegAsync(
          root,
          [
            '-i',
            sourcePath,
            '-i',
            detector.path,
            '-filter_complex',
            filter,
            '-map',
            '[ducked]',
            '-vn',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-c:a',
            'pcm_s16le',
            absolutePath,
          ],
          `Could not apply sidechain compression to clip ${clip.id}`,
          renderControl,
        );
        next.assets.push({
          id,
          path: relativePath,
          type: 'audio',
          hasAudio: true,
          durationSeconds: clip.durationSeconds,
        });
        clip.assetId = id;
        clip.sourceIn = 0;
        clip.sourceOut = clip.durationSeconds;
        delete clip.playbackRate;
        delete clip.speedRamp;
      }
    }
    validateTimeline(next);
    return next;
  } catch (error) {
    for (const asset of temporaryAssets.splice(startIndex)) rmSync(asset, { force: true });
    throw error;
  }
}

function buildTrackStem(root, timeline, track, temporaryAssets, renderControl) {
  const id = `sidechain-source-${track.id}-${randomUUID().slice(0, 8)}`;
  const relativePath = `assets/.${id}-${randomUUID()}.wav`;
  const absolutePath = join(root, ...relativePath.split('/'));
  const args = [];
  const filters = [];
  for (const [index, clip] of track.clips.entries()) {
    const asset = timeline.assets.find((item) => item.id === clip.assetId);
    args.push('-i', join(root, ...asset.path.split('/')));
    const gain = (track.volume ?? 1) * (clip.volume ?? 1);
    const steps = [`atrim=start=${clip.sourceIn}:end=${clip.sourceOut}`, 'asetpts=PTS-STARTPTS', `volume=${gain}`];
    if (clip.fadeInSeconds > 0) steps.push(`afade=t=in:st=0:d=${clip.fadeInSeconds}`);
    if (clip.fadeOutSeconds > 0)
      steps.push(`afade=t=out:st=${clip.durationSeconds - clip.fadeOutSeconds}:d=${clip.fadeOutSeconds}`);
    steps.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    steps.push(`adelay=delays=${Math.round(clip.timelineStart * 1000)}:all=1`);
    filters.push(`[${index}:a:0]${steps.join(',')}[source${index}]`);
  }
  const labels = track.clips.map((_, index) => `[source${index}]`).join('');
  filters.push(
    `${labels}amix=inputs=${track.clips.length}:duration=longest:normalize=0,apad=whole_dur=${timeline.project.durationSeconds},atrim=duration=${timeline.project.durationSeconds},asetpts=PTS-STARTPTS[stem]`,
  );
  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[stem]', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', absolutePath);
  temporaryAssets.push(absolutePath);
  runFfmpeg(root, args, `Could not build sidechain detector stem for track ${track.id}`, renderControl);
  return { id, path: absolutePath };
}

async function buildTrackStemAsync(root, timeline, track, temporaryAssets, renderControl) {
  const id = `sidechain-source-${track.id}-${randomUUID().slice(0, 8)}`;
  const relativePath = `assets/.${id}-${randomUUID()}.wav`;
  const absolutePath = join(root, ...relativePath.split('/'));
  const args = [];
  const filters = [];
  for (const [index, clip] of track.clips.entries()) {
    const asset = timeline.assets.find((item) => item.id === clip.assetId);
    args.push('-i', join(root, ...asset.path.split('/')));
    const gain = (track.volume ?? 1) * (clip.volume ?? 1);
    const steps = [`atrim=start=${clip.sourceIn}:end=${clip.sourceOut}`, 'asetpts=PTS-STARTPTS', `volume=${gain}`];
    if (clip.fadeInSeconds > 0) steps.push(`afade=t=in:st=0:d=${clip.fadeInSeconds}`);
    if (clip.fadeOutSeconds > 0)
      steps.push(`afade=t=out:st=${clip.durationSeconds - clip.fadeOutSeconds}:d=${clip.fadeOutSeconds}`);
    steps.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    steps.push(`adelay=delays=${Math.round(clip.timelineStart * 1000)}:all=1`);
    filters.push(`[${index}:a:0]${steps.join(',')}[source${index}]`);
  }
  const labels = track.clips.map((_, index) => `[source${index}]`).join('');
  filters.push(
    `${labels}amix=inputs=${track.clips.length}:duration=longest:normalize=0,apad=whole_dur=${timeline.project.durationSeconds},atrim=duration=${timeline.project.durationSeconds},asetpts=PTS-STARTPTS[stem]`,
  );
  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[stem]', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', absolutePath);
  temporaryAssets.push(absolutePath);
  await runSidechainFfmpegAsync(
    root,
    args,
    `Could not build sidechain detector stem for track ${track.id}`,
    renderControl,
  );
  return { id, path: absolutePath };
}

function runFfmpeg(cwd, args, message, renderControl) {
  renderControl?.assertActive();
  const result = spawnSync(
    'ffmpeg',
    ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-filter_threads', '1', '-filter_complex_threads', '1', ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
      cwd,
      ...(renderControl ? { timeout: renderControl.timeoutMs() } : {}),
    },
  );
  renderControl?.assertActive();
  if (result.error || result.status !== 0) {
    const error = renderControl?.processError(result.error);
    throw error ?? new Error(`${message}: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

async function runSidechainFfmpegAsync(cwd, args, message, renderControl) {
  try {
    renderControl?.assertActive();
    await runProcess(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-filter_threads',
        '1',
        '-filter_complex_threads',
        '1',
        ...args,
      ],
      { cwd, signal: renderControl?.signal, stdio: 'capture' },
    );
  } catch (error) {
    if (renderControl?.signal.aborted) throw renderControl.signal.reason ?? error;
    throw new Error(`${message}: ${error.message}`, { cause: error });
  }
}
