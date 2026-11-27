import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { frameRateNumber } from './frame-rate.mjs';
import { frameToSeconds } from './frame-time.mjs';
import { probeMedia } from './probe.mjs';

const OUTPUT_FORMATS = {
  '.mp4': { kind: 'video' },
  '.m4a': { kind: 'audio', codecArgs: ['-c:a', 'aac', '-b:a', '192k'], faststart: true },
  '.wav': { kind: 'audio', codecArgs: ['-c:a', 'pcm_s16le'], faststart: false },
};

const CUE_FIELDS = ['file', 'at', 'gainDb', 'fadeInMs', 'fadeOutMs'];
const OPTION_FIELDS = ['duckUnderSpeech', 'gainCapDb', 'fps'];
const DUCK_FIELDS = ['thresholdDb', 'ratio', 'attackMs', 'releaseMs'];
const DUCK_DEFAULTS = { thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 250 };
const MIN_PLACED_SECONDS = 0.001;

export function parseSfxOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('SFX options must be an object.');
  }
  for (const field of Object.keys(options)) {
    if (!OPTION_FIELDS.includes(field)) throw new TypeError(`SFX options have an unsupported field: ${field}.`);
  }
  return {
    duck: parseDuck(options.duckUnderSpeech),
    gainCapDb: parseGainCap(options.gainCapDb),
    fps: options.fps === undefined ? null : frameRateNumber(options.fps),
  };
}

export function parseSfxCues(cues, context = {}) {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('SFX cue context must be an object.');
  }
  const records = readCueRecords(cues);
  const durationSeconds = readOptionalDuration(context.durationSeconds);
  const frameRate = readContextFrameRate(context.frameRate);
  return records.map((record) => finalizeCue(record, { durationSeconds, frameRate, files: context.files }));
}

export function createSfxFilterGraph({
  cues,
  hasSourceAudio,
  sampleRate,
  channels,
  sourceDurationSeconds,
  duck = null,
  gainCapDb = null,
  formatSource = false,
}) {
  if (!Array.isArray(cues) || cues.length === 0) throw new TypeError('SFX filter graph requires at least one cue.');
  if (typeof hasSourceAudio !== 'boolean') throw new TypeError('hasSourceAudio must be a boolean.');
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new TypeError('SFX sample rate must be an integer from 8000 to 192000.');
  }
  if (channels !== 1 && channels !== 2) throw new TypeError('SFX mix channels must be 1 or 2.');
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) {
    throw new TypeError('SFX source duration must be a positive finite number.');
  }
  if (duck && !hasSourceAudio) throw new TypeError('duckUnderSpeech requires source audio.');
  if (typeof formatSource !== 'boolean') throw new TypeError('formatSource must be a boolean.');
  const layout = channels === 1 ? 'mono' : 'stereo';
  const lines = cues.map((cue, index) => cueFilter(cue, index, sampleRate, layout));
  let bus = cues.length === 1 ? 's0' : 'sfx';
  if (cues.length > 1) {
    const inputs = cues.map((_, index) => `[s${index}]`).join('');
    lines.push(`${inputs}amix=inputs=${cues.length}:duration=longest:dropout_transition=0:normalize=0[${bus}]`);
  }
  if (gainCapDb !== null) {
    const limit = 10 ** (gainCapDb / 20);
    lines.push(`[${bus}]alimiter=limit=${formatNumber(limit)}:attack=5:release=50:level=0[sfxlim]`);
    bus = 'sfxlim';
  }
  if (!hasSourceAudio) {
    lines.push(
      `[${bus}]apad=whole_dur=${formatNumber(sourceDurationSeconds)},atrim=end=${formatNumber(sourceDurationSeconds)}[a]`,
    );
    return `${lines.join(';\n')}\n`;
  }
  if (formatSource) {
    lines.push(`[0:a]aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}[src]`);
  }
  const sourceRef = formatSource ? '[src]' : '[0:a]';
  if (duck) {
    const threshold = 10 ** (duck.thresholdDb / 20);
    lines.push(`${sourceRef}asplit=2[base][key]`);
    lines.push(
      `[${bus}][key]sidechaincompress=threshold=${formatNumber(threshold)}:ratio=${formatNumber(duck.ratio)}:attack=${formatNumber(duck.attackMs)}:release=${formatNumber(duck.releaseMs)}:makeup=1:detection=rms:link=average[sfxduck]`,
    );
    lines.push('[base][sfxduck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
  } else {
    lines.push(`${sourceRef}[${bus}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`);
  }
  return `${lines.join(';\n')}\n`;
}

export function mixSfx(inputPath, cues, outputPath, options = {}) {
  const parsedOptions = parseSfxOptions(options);
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (input === output) throw new Error('Output path must differ from the source media.');
  const extension = extname(output).toLowerCase();
  const format = OUTPUT_FORMATS[extension];
  if (!format) throw new Error('SFX output must use a .mp4, .m4a, or .wav extension.');
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  readCueRecords(cues);

  const media = probeMedia(input, { requireVideo: false });
  const audioOnly = format.kind === 'audio';
  if (!audioOnly && media.videoStreams.length === 0) {
    throw new Error('Audio-only input cannot be written as .mp4. Use .m4a or .wav.');
  }
  if (parsedOptions.duck && !media.hasAudio) {
    throw new Error('duckUnderSpeech requires an audio stream in the source.');
  }
  const frameRate = resolveMixFrameRate(media.frameRate, parsedOptions.fps);
  const files = collectCueFiles(cues);
  const normalized = parseSfxCues(cues, {
    durationSeconds: media.durationSeconds,
    frameRate,
    files,
  });
  for (const cue of normalized) {
    if (resolve(cue.file) === output) throw new Error(`Output path must differ from SFX cue file: ${cue.file}`);
  }

  const mix = mixFormat(media);
  const filterGraph = createSfxFilterGraph({
    cues: normalized,
    hasSourceAudio: media.hasAudio,
    sampleRate: mix.sampleRate,
    channels: mix.channels,
    sourceDurationSeconds: media.durationSeconds,
    duck: parsedOptions.duck,
    gainCapDb: parsedOptions.gainCapDb,
    formatSource: sourceNeedsFormat(media, mix),
  });
  renderSfx(input, normalized, output, format, filterGraph, media);
  return {
    input,
    output,
    durationSeconds: media.durationSeconds,
    frameRate,
    cues: normalized,
    duckUnderSpeech: parsedOptions.duck !== null,
    ...(parsedOptions.duck ? { duck: parsedOptions.duck } : {}),
    gainCapDb: parsedOptions.gainCapDb,
  };
}

function readCueRecords(cues) {
  if (!Array.isArray(cues)) throw new TypeError('SFX cues must be an array.');
  if (cues.length === 0) throw new TypeError('SFX cues must contain at least one cue.');
  return cues.map((cue, index) => readCueRecord(cue, index + 1));
}

function readCueRecord(cue, index) {
  if (!cue || typeof cue !== 'object' || Array.isArray(cue)) {
    throw new TypeError(`SFX cue ${index} must be an object.`);
  }
  for (const field of Object.keys(cue)) {
    if (!CUE_FIELDS.includes(field)) throw new TypeError(`SFX cue ${index} has an unsupported field: ${field}.`);
  }
  if (typeof cue.file !== 'string' || !cue.file.trim()) {
    throw new TypeError(`SFX cue ${index} file must be a non-empty path.`);
  }
  if (cue.at === undefined) throw new TypeError(`SFX cue ${index} requires at.`);
  validateCueAt(cue.at, index);
  const gainDb = cue.gainDb ?? 0;
  if (typeof gainDb !== 'number' || !Number.isFinite(gainDb) || gainDb < -60 || gainDb > 24) {
    throw new TypeError(`SFX cue ${index} gainDb must be a finite number from -60 to 24.`);
  }
  return {
    cueIndex: index,
    file: cue.file,
    at: cue.at,
    gainDb,
    fadeInMs: readFade(cue.fadeInMs, index, 'fadeInMs'),
    fadeOutMs: readFade(cue.fadeOutMs, index, 'fadeOutMs'),
  };
}

function finalizeCue(record, context) {
  const startSeconds = readCueStart(record.at, record.cueIndex, context.frameRate);
  const fileInfo = readCueFile(record, context.files);
  const fadeInSeconds = record.fadeInMs / 1000;
  const fadeOutSeconds = record.fadeOutMs / 1000;
  let placedSeconds = fileInfo ? fileInfo.durationSeconds : null;
  if (context.durationSeconds !== null && startSeconds >= context.durationSeconds) {
    throw outsideSource(record, startSeconds, context.durationSeconds);
  }
  if (context.durationSeconds !== null && fileInfo) {
    const remaining = context.durationSeconds - startSeconds;
    if (remaining < MIN_PLACED_SECONDS) throw outsideSource(record, startSeconds, context.durationSeconds);
    placedSeconds = Math.min(fileInfo.durationSeconds, remaining);
  }
  if (placedSeconds !== null && placedSeconds < MIN_PLACED_SECONDS) {
    throw new Error(`SFX cue ${record.cueIndex} file has no usable audio duration: ${record.file}`);
  }
  if (placedSeconds !== null && fadeInSeconds + fadeOutSeconds > placedSeconds) {
    throw new Error(
      `SFX cue ${record.cueIndex} fades are longer than the ${formatNumber(placedSeconds)}s placed clip.`,
    );
  }
  return {
    file: record.file,
    startSeconds,
    gainDb: record.gainDb,
    fadeInSeconds,
    fadeOutSeconds,
    ...(placedSeconds === null ? {} : { placedSeconds }),
  };
}

function outsideSource(record, startSeconds, durationSeconds) {
  return new Error(
    `SFX cue ${record.cueIndex} starts at ${formatNumber(startSeconds)}s, which is outside the ${formatNumber(durationSeconds)}s source.`,
  );
}

function validateCueAt(at, index) {
  if (typeof at === 'number') {
    if (!Number.isFinite(at) || at < 0) {
      throw new TypeError(`SFX cue ${index} at must be a non-negative finite number of seconds.`);
    }
    return;
  }
  if (!at || typeof at !== 'object' || Array.isArray(at)) {
    throw new TypeError(`SFX cue ${index} at must be seconds or an object with seconds or frame.`);
  }
  const keys = Object.keys(at);
  if (keys.length !== 1 || (keys[0] !== 'seconds' && keys[0] !== 'frame')) {
    throw new TypeError(`SFX cue ${index} at must contain only seconds or frame.`);
  }
  if (keys[0] === 'seconds') {
    if (typeof at.seconds !== 'number' || !Number.isFinite(at.seconds) || at.seconds < 0) {
      throw new TypeError(`SFX cue ${index} at.seconds must be a non-negative finite number.`);
    }
    return;
  }
  if (!Number.isSafeInteger(at.frame) || at.frame < 0) {
    throw new TypeError(`SFX cue ${index} at.frame must be a non-negative integer.`);
  }
}

function readCueStart(at, index, frameRate) {
  if (typeof at === 'number') return at;
  if (Object.hasOwn(at, 'seconds')) return at.seconds;
  if (!Number.isFinite(frameRate)) {
    throw new TypeError(`SFX cue ${index} uses a frame but no frame rate is available. Set options.fps.`);
  }
  return frameToSeconds(at.frame, frameRate);
}

function readCueFile(record, files) {
  if (files === undefined) return null;
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.hasOwn(files, record.file)) {
    throw new Error(`SFX cue ${record.cueIndex} file not found: ${record.file}`);
  }
  const info = files[record.file];
  if (info == null) throw new Error(`SFX cue ${record.cueIndex} file not found: ${record.file}`);
  if (
    typeof info !== 'object' ||
    typeof info.durationSeconds !== 'number' ||
    !Number.isFinite(info.durationSeconds) ||
    info.durationSeconds <= 0
  ) {
    throw new TypeError(`SFX cue ${record.cueIndex} file has no positive duration: ${record.file}`);
  }
  if (info.hasAudio === false) throw new Error(`SFX cue ${record.cueIndex} has no audio stream: ${record.file}`);
  return info;
}

function readFade(value, index, field) {
  const fade = value ?? 0;
  if (typeof fade !== 'number' || !Number.isFinite(fade) || fade < 0) {
    throw new TypeError(`SFX cue ${index} ${field} must be a non-negative finite number.`);
  }
  return fade;
}

function readOptionalDuration(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('SFX source duration must be a positive finite number.');
  }
  return value;
}

function readContextFrameRate(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  return frameRateNumber(value);
}

function parseDuck(value) {
  if (value === undefined || value === false) return null;
  const settings = value === true ? { ...DUCK_DEFAULTS } : readDuckObject(value);
  if (!Number.isFinite(settings.thresholdDb) || settings.thresholdDb < -60 || settings.thresholdDb > 0) {
    throw new TypeError('duckUnderSpeech thresholdDb must be between -60 and 0.');
  }
  if (!Number.isFinite(settings.ratio) || settings.ratio < 1 || settings.ratio > 20) {
    throw new TypeError('duckUnderSpeech ratio must be between 1 and 20.');
  }
  if (!Number.isFinite(settings.attackMs) || settings.attackMs < 0.01 || settings.attackMs > 2000) {
    throw new TypeError('duckUnderSpeech attackMs must be between 0.01 and 2000.');
  }
  if (!Number.isFinite(settings.releaseMs) || settings.releaseMs < 0.01 || settings.releaseMs > 9000) {
    throw new TypeError('duckUnderSpeech releaseMs must be between 0.01 and 9000.');
  }
  return settings;
}

function readDuckObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('duckUnderSpeech must be a boolean or settings object.');
  }
  for (const field of Object.keys(value)) {
    if (!DUCK_FIELDS.includes(field)) throw new TypeError(`duckUnderSpeech has an unsupported field: ${field}.`);
  }
  return { ...DUCK_DEFAULTS, ...value };
}

function parseGainCap(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -24 || value > 0) {
    throw new TypeError('gainCapDb must be a finite number from -24 to 0.');
  }
  return value;
}

function resolveMixFrameRate(sourceFrameRate, optionFrameRate) {
  const source = Number.isFinite(sourceFrameRate) && sourceFrameRate >= 1 ? sourceFrameRate : null;
  if (source && optionFrameRate && Math.abs(source - optionFrameRate) > 0.001) {
    throw new Error(
      `options.fps (${formatNumber(optionFrameRate)}) does not match the source frame rate (${formatNumber(source)}).`,
    );
  }
  return optionFrameRate ?? source;
}

function collectCueFiles(cues) {
  const files = {};
  for (const [offset, cue] of cues.entries()) {
    const index = offset + 1;
    const path = resolve(cue.file);
    if (!existsSync(path)) throw new Error(`SFX cue ${index} file not found: ${path}`);
    let probed;
    try {
      probed = probeMedia(path, { requireVideo: false });
    } catch (error) {
      throw new Error(`SFX cue ${index} could not be read: ${error.message}`);
    }
    if (!probed.hasAudio) throw new Error(`SFX cue ${index} has no audio stream: ${path}`);
    files[cue.file] = { durationSeconds: probed.durationSeconds, hasAudio: true };
  }
  return files;
}

function mixFormat(media) {
  const audio = media.audioStreams[0];
  const sampleRate =
    audio?.sampleRate && audio.sampleRate >= 8000 && audio.sampleRate <= 192000 ? audio.sampleRate : 48000;
  const channels = audio?.channels === 1 ? 1 : 2;
  return { sampleRate, channels };
}

function sourceNeedsFormat(media, mix) {
  const audio = media.audioStreams[0];
  if (!audio) return false;
  return audio.channels !== mix.channels || audio.sampleRate !== mix.sampleRate;
}

function cueFilter(cue, index, sampleRate, layout) {
  if (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0) {
    throw new TypeError(`SFX cue ${index + 1} startSeconds must be a non-negative finite number.`);
  }
  if (!Number.isFinite(cue.placedSeconds) || cue.placedSeconds < MIN_PLACED_SECONDS) {
    throw new TypeError(`SFX cue ${index + 1} placedSeconds must be a positive finite number.`);
  }
  const filters = [`aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}`];
  if (cue.gainDb !== 0) filters.push(`volume=${formatNumber(cue.gainDb)}dB`);
  filters.push(`atrim=end=${formatNumber(cue.placedSeconds)}`, 'asetpts=PTS-STARTPTS');
  if (cue.fadeInSeconds > 0) filters.push(`afade=t=in:d=${formatNumber(cue.fadeInSeconds)}`);
  if (cue.fadeOutSeconds > 0) {
    filters.push(
      `afade=t=out:st=${formatNumber(cue.placedSeconds - cue.fadeOutSeconds)}:d=${formatNumber(cue.fadeOutSeconds)}`,
    );
  }
  if (cue.startSeconds > 0) filters.push(`adelay=${formatNumber(cue.startSeconds * 1000)}:all=1`);
  return `[${index + 1}:a]${filters.join(',')}[s${index}]`;
}

function renderSfx(input, cues, output, format, filterGraph, media) {
  const extension = extname(output);
  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });
  const token = randomUUID();
  const filterPath = resolve(outputDir, `.${basename(output)}.${token}.filter.txt`);
  const temporaryOutput = resolve(outputDir, `.${basename(output, extension)}.${token}.tmp${extension}`);
  const audioOnly = format.kind === 'audio';
  writeFileSync(filterPath, filterGraph, { flag: 'wx' });
  let outputCreated = false;
  try {
    const args = ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-i', input];
    for (const cue of cues) args.push('-i', resolve(cue.file));
    args.push('-filter_complex_script', filterPath, '-map', '[a]');
    if (audioOnly) {
      args.push(...format.codecArgs);
      if (format.faststart) args.push('-movflags', '+faststart');
    } else {
      args.splice(args.indexOf('-map'), 0, '-map', '0:v:0');
      args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
    }
    args.push(temporaryOutput);
    let result = spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true });
    if (
      result.status !== 0 &&
      /filter_complex_script/i.test(result.stderr ?? '') &&
      /unrecognized option|option not found/i.test(result.stderr ?? '')
    ) {
      const optionIndex = args.indexOf('-filter_complex_script');
      args.splice(optionIndex, 2, '-filter_complex', filterGraph);
      result = spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true });
    }
    if (result.error || result.status !== 0) {
      throw new Error(`ffmpeg failed: ${result.error?.message ?? result.stderr.trim()}`);
    }
    closeSync(openSync(output, 'wx'));
    outputCreated = true;
    copyFileSync(temporaryOutput, output);
    const rendered = probeMedia(output, { requireVideo: !audioOnly });
    const tolerance = Math.max(0.15, 1 / (media.frameRate || 30));
    if (Math.abs(rendered.durationSeconds - media.durationSeconds) > tolerance) {
      throw new Error(
        `Mixed duration ${rendered.durationSeconds.toFixed(3)}s does not match the source ${media.durationSeconds.toFixed(3)}s.`,
      );
    }
    if (!rendered.hasAudio) throw new Error('Mixed output has no audio stream.');
    if (audioOnly && rendered.videoStreams.length > 0) throw new Error('Audio SFX output contains a video stream.');
    if (!audioOnly && (rendered.width !== media.width || rendered.height !== media.height)) {
      throw new Error('Mixed video dimensions do not match the source.');
    }
  } catch (error) {
    if (outputCreated && existsSync(output)) unlinkSync(output);
    throw error;
  } finally {
    rmSync(filterPath, { force: true });
    rmSync(temporaryOutput, { force: true });
  }
}

function formatNumber(value) {
  const text = value.toFixed(6).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}
