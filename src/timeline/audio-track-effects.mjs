import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../render/process.mjs';
import { buildAudioClipEffectFilters } from './audio-effects.mjs';
import { buildAudioVolumeAutomation } from './audio-mix.mjs';

export function applyAudioTrackEffectProxies(root, timeline, temporaryAssets) {
  const context = prepareAudioTrackEffectProxies(root, timeline, temporaryAssets);
  try {
    for (const job of context.jobs) {
      const result = spawnSync('ffmpeg', job.args, {
        encoding: 'utf8',
        windowsHide: true,
        cwd: root,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) {
        throw new Error(`Could not apply audio effects to track ${job.trackId}: ${result.error?.message ?? result.stderr.trim()}`);
      }
    }
    return context.timeline;
  } catch (error) {
    removePreparedAssets(temporaryAssets, context.startIndex);
    throw error;
  }
}

export async function applyAudioTrackEffectProxiesAsync(root, timeline, temporaryAssets, renderControl) {
  const context = prepareAudioTrackEffectProxies(root, timeline, temporaryAssets);
  try {
    for (const job of context.jobs) {
      renderControl.assertActive();
      try {
        await runProcess('ffmpeg', job.args, { cwd: root, signal: renderControl.signal, stdio: 'capture' });
      } catch (error) {
        if (renderControl.signal.aborted) throw renderControl.signal.reason ?? error;
        throw new Error(`Could not apply audio effects to track ${job.trackId}: ${error.message}`, { cause: error });
      }
      renderControl.assertActive();
    }
    return context.timeline;
  } catch (error) {
    removePreparedAssets(temporaryAssets, context.startIndex);
    throw error;
  }
}

function prepareAudioTrackEffectProxies(root, timeline, temporaryAssets) {
  const next = structuredClone(timeline);
  const startIndex = temporaryAssets.length;
  const jobs = [];
  try {
    for (const track of next.tracks) {
      if (track.kind !== 'audio' || !track.audioEffects?.length || track.clips.length === 0) continue;
      const sourceClips = track.clips.map((clip) => ({ timelineStart: clip.timelineStart, durationSeconds: clip.durationSeconds }));
      const labels = [];
      const filters = [];
      const args = [];
      for (const [index, clip] of track.clips.entries()) {
        const asset = next.assets.find((entry) => entry.id === clip.assetId);
        if (!asset) throw new TypeError(`Track ${track.id} clip ${clip.id} is missing its audio asset.`);
        args.push('-i', join(root, ...asset.path.split('/')));
        const automation = buildAudioVolumeAutomation(next, track, clip);
        const label = `trackclip${index}`;
        labels.push(`[${label}]`);
        const steps = [
          `atrim=start=${clip.sourceIn}:end=${clip.sourceOut}`,
          'asetpts=PTS-STARTPTS',
          'aresample=48000',
          'aformat=sample_fmts=fltp:channel_layouts=stereo',
          `volume='${toVolumeExpression(automation, clip.timelineStart)}':eval=frame`,
          `adelay=delays=${Math.round(clip.timelineStart * 1000)}:all=1`,
        ];
        filters.push(`[${index}:a:${clip.audioStreamIndex ?? 0}]${steps.join(',')}[${label}]`);
      }
      const effectFilters = buildAudioClipEffectFilters(track.audioEffects);
      const outputLabel = 'trackfxout';
      filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,apad=whole_dur=${next.project.durationSeconds},atrim=duration=${next.project.durationSeconds},asetpts=PTS-STARTPTS${effectFilters.length ? `,${effectFilters.join(',')}` : ''}[${outputLabel}]`);
      const id = `track-effects-${track.id}-${randomUUID().slice(0, 8)}`;
      const relativePath = `assets/.${id}-${randomUUID()}.wav`;
      const absolutePath = join(root, ...relativePath.split('/'));
      temporaryAssets.push(absolutePath);
      jobs.push({
        trackId: track.id,
        args: [
          '-nostdin', '-hide_banner', '-v', 'error', '-y', '-filter_threads', '1', '-filter_complex_threads', '1',
          ...args, '-filter_complex', filters.join(';'), '-map', `[${outputLabel}]`, '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', absolutePath,
        ],
      });
      next.assets.push({ id, path: relativePath, type: 'audio', hasAudio: true, durationSeconds: next.project.durationSeconds });
      track.clips = [{
        id: `processed-${track.id}`,
        assetId: id,
        sourceIn: 0,
        sourceOut: next.project.durationSeconds,
        timelineStart: 0,
        durationSeconds: next.project.durationSeconds,
      }];
      track.volume = 1;
      delete track.volumeKeyframes;
      delete track.audioEffects;
      track._duckingIntervals = sourceClips;
    }

    const effectedTrackIds = new Set(next.tracks.filter((track) => track.kind === 'audio' && track._duckingIntervals).map((track) => track.id));
    if (next.audioMix?.ducking) {
      const ducking = next.audioMix.ducking.filter((rule) => !effectedTrackIds.has(rule.targetTrackId));
      if (ducking.length === 0) delete next.audioMix.ducking;
      else next.audioMix.ducking = ducking;
      if (Object.keys(next.audioMix).length === 0) delete next.audioMix;
    }
    return { timeline: next, jobs, startIndex };
  } catch (error) {
    removePreparedAssets(temporaryAssets, startIndex);
    throw error;
  }
}

function removePreparedAssets(temporaryAssets, startIndex) {
  for (const asset of temporaryAssets.splice(startIndex)) rmSync(asset, { force: true });
}

function toVolumeExpression(points, clipStart) {
  if (points.length === 0) return '1';
  let expression = String(points.at(-1).volume);
  for (let index = points.length - 2; index >= 0; index--) {
    const from = points[index];
    const to = points[index + 1];
    const fromTime = from.time - clipStart;
    const toTime = to.time - clipStart;
    const span = toTime - fromTime;
    if (span <= 0) continue;
    const linear = `(${from.volume}+(${to.volume - from.volume})*(t-${fromTime})/${span})`;
    expression = `if(lt(t\\,${toTime})\\,${linear}\\,${expression})`;
  }
  return expression;
}
