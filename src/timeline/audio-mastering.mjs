import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeMedia } from '../media/probe.mjs';
import { frameRateNumber } from '../media/frame-rate.mjs';

const DEFAULTS = Object.freeze({
  integratedLoudnessLUFS: -16,
  truePeakDBTP: -1.5,
  loudnessRangeLU: 11,
});
const EQ_FIELDS = new Set(['frequencyHz', 'gainDB', 'q']);

export function validateAudioMastering(timeline) {
  const settings = timeline.audioMastering;
  if (settings === undefined) return undefined;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Timeline audioMastering must be an object.');
  const allowed = new Set([...Object.keys(DEFAULTS), 'equalizer', 'limiter', 'channelLayout']);
  for (const field of Object.keys(settings)) if (!allowed.has(field)) throw new TypeError(`Timeline audioMastering has an unsupported setting: ${field}.`);
  validateEqualizer(settings.equalizer);
  validateLimiter(settings.limiter);
  if (settings.channelLayout !== undefined && !['mono', 'stereo'].includes(settings.channelLayout)) {
    throw new TypeError('Timeline audioMastering.channelLayout must be mono or stereo.');
  }
  const values = { ...DEFAULTS, ...settings };
  if (!Number.isFinite(values.integratedLoudnessLUFS) || values.integratedLoudnessLUFS < -70 || values.integratedLoudnessLUFS > -5) {
    throw new TypeError('Timeline audioMastering.integratedLoudnessLUFS must be between -70 and -5 LUFS.');
  }
  if (!Number.isFinite(values.truePeakDBTP) || values.truePeakDBTP < -9 || values.truePeakDBTP > 0) {
    throw new TypeError('Timeline audioMastering.truePeakDBTP must be between -9 and 0 dBTP.');
  }
  if (!Number.isFinite(values.loudnessRangeLU) || values.loudnessRangeLU < 1 || values.loudnessRangeLU > 50) {
    throw new TypeError('Timeline audioMastering.loudnessRangeLU must be between 1 and 50 LU.');
  }
  if (!timeline.tracks.some((track) => track.kind === 'audio' && track.clips.length > 0)) {
    throw new TypeError('Timeline audioMastering requires at least one audio clip.');
  }
  return values;
}

export function masterAudioFile(outputPath, format, settings, fps) {
  const input = probeMedia(outputPath);
  if (!input.hasAudio) throw new Error('Cannot master loudness because the rendered output has no audio stream.');
  const baseFilter = `loudnorm=I=${settings.integratedLoudnessLUFS}:TP=${settings.truePeakDBTP}:LRA=${settings.loudnessRangeLU}`;
  const channelFilter = settings.channelLayout ? [`aresample=ochl=${settings.channelLayout}`] : [];
  const equalizerFilters = buildEqualizerFilters(settings.equalizer);
  const preLoudnessFilters = [...channelFilter, ...equalizerFilters];
  const preLoudnessPrefix = preLoudnessFilters.length ? `${preLoudnessFilters.join(',')},` : '';
  const analysis = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'info', '-i', outputPath,
    '-map', '0:a:0', '-af', `${preLoudnessPrefix}${baseFilter}:print_format=json`, '-f', 'null', nullDevice(),
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (analysis.error || analysis.status !== 0) throw new Error(`Could not analyze rendered audio loudness: ${analysis.error?.message ?? analysis.stderr.trim()}`);
  const loudness = parseLoudnessAnalysis(analysis.stderr);
  const loudnessFilter = loudness.measured
    ? `${baseFilter}:measured_I=${loudness.measured.input_i}:measured_TP=${loudness.measured.input_tp}:measured_LRA=${loudness.measured.input_lra}:measured_thresh=${loudness.measured.input_thresh}:offset=${loudness.measured.target_offset}:linear=true:print_format=summary`
    : loudness.silent ? undefined : `${baseFilter}:print_format=summary`;
  const limiterFilter = settings.limiter ? buildLimiterFilter(settings.limiter) : undefined;
  const filter = [...preLoudnessFilters, loudnessFilter, limiterFilter].filter(Boolean).join(',') || undefined;
  const extension = extname(outputPath);
  const temporaryPath = join(dirname(outputPath), `.${basename(outputPath, extension)}.${randomUUID()}.master${extension}`);
  try {
    const audioCodec = format === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k'] : ['-c:a', 'aac', '-b:a', '256k'];
    const encode = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', outputPath,
      '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', ...audioCodec,
      ...(filter ? ['-af', filter] : []), '-ar', '48000',
      ...(settings.channelLayout ? ['-ac', settings.channelLayout === 'mono' ? '1' : '2', '-channel_layout', settings.channelLayout] : []),
      ...(format === 'mp4' || format === 'mov' ? ['-movflags', '+faststart'] : []),
      temporaryPath,
    ], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (encode.error || encode.status !== 0) throw new Error(`Could not apply rendered audio mastering: ${encode.error?.message ?? encode.stderr.trim()}`);
    const mastered = probeMedia(temporaryPath);
    const expectedChannels = settings.channelLayout === 'mono' ? 1 : settings.channelLayout === 'stereo' ? 2 : undefined;
    if (!mastered.hasAudio || mastered.width !== input.width || mastered.height !== input.height
        || (expectedChannels !== undefined && mastered.audioChannels !== expectedChannels)
        || Math.abs(mastered.durationSeconds - input.durationSeconds) > Math.max(0.15, 1 / frameRateNumber(fps))) {
      throw new Error('Mastered output failed audio/video stream or channel-layout validation.');
    }
    unlinkSync(outputPath);
    renameSync(temporaryPath, outputPath);
    return {
      ...mastered,
      loudnessMode: loudness.measured ? 'two-pass-linear' : loudness.silent ? 'silent-bypass' : 'single-pass-dynamic',
    };
  } catch (error) {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function validateEqualizer(equalizer) {
  if (equalizer === undefined) return;
  if (!Array.isArray(equalizer) || equalizer.length > 10) throw new TypeError('Timeline audioMastering.equalizer must be an array with at most 10 bands.');
  for (const [index, band] of equalizer.entries()) {
    if (!band || typeof band !== 'object' || Array.isArray(band) || Object.keys(band).some((field) => !EQ_FIELDS.has(field))) {
      throw new TypeError(`Timeline audioMastering.equalizer band ${index} has an invalid shape.`);
    }
    if (!Number.isFinite(band.frequencyHz) || band.frequencyHz < 20 || band.frequencyHz > 20000) {
      throw new TypeError(`Timeline audioMastering.equalizer band ${index} frequencyHz must be from 20 to 20000.`);
    }
    if (!Number.isFinite(band.gainDB) || band.gainDB < -18 || band.gainDB > 18) {
      throw new TypeError(`Timeline audioMastering.equalizer band ${index} gainDB must be from -18 to 18.`);
    }
    if (band.q !== undefined && (!Number.isFinite(band.q) || band.q < 0.1 || band.q > 10)) {
      throw new TypeError(`Timeline audioMastering.equalizer band ${index} q must be from 0.1 to 10.`);
    }
  }
}

function validateLimiter(limiter) {
  if (limiter === undefined) return;
  const fields = ['limitDBFS', 'attackMs', 'releaseMs'];
  if (!limiter || typeof limiter !== 'object' || Array.isArray(limiter) || Object.keys(limiter).some((field) => !fields.includes(field))) {
    throw new TypeError('Timeline audioMastering.limiter has an invalid shape.');
  }
  if (!Number.isFinite(limiter.limitDBFS) || limiter.limitDBFS < -20 || limiter.limitDBFS > 0) {
    throw new TypeError('Timeline audioMastering.limiter.limitDBFS must be from -20 to 0.');
  }
  if (!Number.isFinite(limiter.attackMs) || limiter.attackMs < 0.1 || limiter.attackMs > 80) {
    throw new TypeError('Timeline audioMastering.limiter.attackMs must be from 0.1 to 80.');
  }
  if (!Number.isFinite(limiter.releaseMs) || limiter.releaseMs < 10 || limiter.releaseMs > 1000) {
    throw new TypeError('Timeline audioMastering.limiter.releaseMs must be from 10 to 1000.');
  }
}

function buildEqualizerFilters(equalizer = []) {
  return equalizer.map(({ frequencyHz, gainDB, q = 1 }) => `equalizer=f=${frequencyHz}:t=q:w=${q}:g=${gainDB}`);
}

function buildLimiterFilter({ limitDBFS, attackMs, releaseMs }) {
  const linearLimit = 10 ** (limitDBFS / 20);
  return `alimiter=limit=${linearLimit}:attack=${attackMs}:release=${releaseMs}:level=0`;
}

function parseLoudnessAnalysis(stderr) {
  const blocks = [...stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  if (blocks.length === 0) return { silent: false };
  let values;
  try {
    values = JSON.parse(blocks.at(-1)[0]);
  } catch {
    return { silent: false };
  }
  if (values.input_i === '-inf' && values.input_tp === '-inf') return { silent: true };
  const required = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
  if (!required.every((field) => Number.isFinite(Number(values[field])))) return { silent: false };
  return { measured: Object.fromEntries(required.map((field) => [field, Number(values[field])])) };
}

function nullDevice() {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}
