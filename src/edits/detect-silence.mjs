import { spawnSync } from 'node:child_process';
import { probeMedia } from '../media/probe.mjs';
import { validateEdl } from './retime-transcript.mjs';

export function detectAcousticSilence(inputPath, options = {}) {
  const media = probeMedia(inputPath, { requireVideo: false });
  if (!media.hasAudio) throw new TypeError('Acoustic silence detection requires an audio stream.');
  const noiseDb = options.noiseDb ?? -35;
  const minSilenceSeconds = options.minSilenceSeconds ?? 0.5;
  const paddingSeconds = options.paddingSeconds ?? 0.12;
  if (!Number.isFinite(noiseDb) || noiseDb < -90 || noiseDb > 0) throw new TypeError('noiseDb must be between -90 and 0.');
  if (!Number.isFinite(minSilenceSeconds) || minSilenceSeconds <= 0) throw new TypeError('minSilenceSeconds must be positive.');
  if (!Number.isFinite(paddingSeconds) || paddingSeconds < 0) throw new TypeError('paddingSeconds must be non-negative.');

  const result = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-i', media.path,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilenceSeconds}`,
    '-f', 'null', '-',
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`FFmpeg silence detection failed: ${result.error?.message ?? result.stderr.trim()}`);

  const intervals = parseSilenceIntervals(result.stderr, media.durationSeconds);
  const cuts = intervals.flatMap(({ start, end }) => {
    const sourceStart = round(start + paddingSeconds);
    const sourceEnd = round(end - paddingSeconds);
    return sourceEnd > sourceStart ? [{ sourceStart, sourceEnd, reason: `acoustic silence (${round(end - start)}s)` }] : [];
  });
  const edl = { schemaVersion: 1, sourceDurationSeconds: media.durationSeconds, cuts };
  validateEdl(edl, media.durationSeconds);
  return edl;
}

export function parseSilenceIntervals(log, durationSeconds) {
  const intervals = [];
  const events = /silence_(start|end):\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g;
  let silenceStart;
  for (const match of log.matchAll(events)) {
    const time = Number(match[2]);
    if (match[1] === 'start') silenceStart = Math.max(0, time);
    else if (silenceStart !== undefined && time > silenceStart) {
      intervals.push({ start: silenceStart, end: Math.min(time, durationSeconds) });
      silenceStart = undefined;
    }
  }
  if (silenceStart !== undefined && durationSeconds > silenceStart) intervals.push({ start: silenceStart, end: durationSeconds });
  return intervals;
}

function round(value) {
  return Number(value.toFixed(3));
}
