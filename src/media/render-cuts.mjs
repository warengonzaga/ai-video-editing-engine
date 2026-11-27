import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { assertEdlApproved, validateEdl } from '../edits/retime-transcript.mjs';
import { probeMedia } from './probe.mjs';

const OUTPUT_FORMATS = {
  '.mp4': { kind: 'video' },
  '.m4a': { kind: 'audio', codecArgs: ['-c:a', 'aac', '-b:a', '192k'], faststart: true },
  '.wav': { kind: 'audio', codecArgs: ['-c:a', 'pcm_s16le'], faststart: false },
};

export function renderCuts(inputPath, edl, outputPath, options = {}) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (input === output) throw new Error('Output path must differ from the source media.');
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const extension = extname(output).toLowerCase();
  const format = OUTPUT_FORMATS[extension];
  if (!format) throw new Error('Cut output must use a .mp4, .m4a, or .wav extension.');
  const joinFadeSeconds = readJoinFadeSeconds(options);

  const media = probeMedia(input, { requireVideo: false });
  const audioOnly = format.kind === 'audio';
  if (!audioOnly && media.videoStreams.length === 0) {
    throw new Error('Audio-only input cannot be written as .mp4. Use .m4a or .wav.');
  }
  if (audioOnly && !media.hasAudio) throw new Error('Audio output requires an audio stream.');
  if (joinFadeSeconds > 0 && !media.hasAudio) throw new Error('joinFadeMs requires an audio stream.');
  validateEdl(edl, media.durationSeconds);
  assertEdlApproved(edl);
  const keepRanges = getKeepRanges(media.durationSeconds, edl.cuts);
  if (!keepRanges.length) throw new Error('EDL removes the entire source.');

  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });
  const token = randomUUID();
  const filterPath = resolve(outputDir, `.${basename(output)}.${token}.filter.txt`);
  const temporaryOutput = resolve(outputDir, `.${basename(output, extension)}.${token}.tmp${extension}`);
  const filterGraph = createFilterGraph(keepRanges, media.hasAudio, { audioOnly, joinFadeSeconds });
  writeFileSync(filterPath, filterGraph, { flag: 'wx' });
  let outputCreated = false;
  try {
    const args = [
      '-nostdin',
      '-hide_banner',
      '-v',
      'error',
      '-n',
      '-i',
      input,
      '-/filter_complex',
      filterPath,
      '-map',
      audioOnly ? '[a]' : '[v]',
    ];
    if (audioOnly) {
      args.push(...format.codecArgs);
      if (format.faststart) args.push('-movflags', '+faststart');
    } else {
      if (media.hasAudio) args.push('-map', '[a]');
      else args.push('-an');
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
      if (media.hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
      args.push('-movflags', '+faststart');
    }
    args.push(temporaryOutput);
    let result = spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 && /unrecognized option ['"]?\/?filter_complex|option not found/i.test(result.stderr)) {
      const optionIndex = args.indexOf('-/filter_complex');
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
    const expectedDuration = keepRanges.reduce((sum, range) => sum + range.end - range.start, 0);
    if (Math.abs(rendered.durationSeconds - expectedDuration) > Math.max(0.15, 1 / (media.frameRate || 30))) {
      throw new Error(
        `Rendered duration ${rendered.durationSeconds.toFixed(3)}s does not match expected ${expectedDuration.toFixed(3)}s.`,
      );
    }
    if (audioOnly ? !rendered.hasAudio : media.hasAudio !== rendered.hasAudio) {
      throw new Error('Rendered audio stream does not match the source.');
    }
    return {
      input,
      output,
      keepRanges,
      durationSeconds: expectedDuration,
    };
  } catch (error) {
    if (outputCreated && existsSync(output)) unlinkSync(output);
    throw error;
  } finally {
    rmSync(filterPath, { force: true });
    rmSync(temporaryOutput, { force: true });
  }
}

export function getKeepRanges(durationSeconds, cuts) {
  const ranges = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.sourceStart > cursor) ranges.push({ start: cursor, end: cut.sourceStart });
    cursor = cut.sourceEnd;
  }
  if (cursor < durationSeconds) ranges.push({ start: cursor, end: durationSeconds });
  return ranges;
}

export function createFilterGraph(ranges, hasAudio, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Filter graph options must be an object.');
  }
  const audioOnly = options.audioOnly === true;
  const joinFadeSeconds = options.joinFadeSeconds ?? 0;
  if (typeof joinFadeSeconds !== 'number' || !Number.isFinite(joinFadeSeconds) || joinFadeSeconds < 0) {
    throw new TypeError('joinFadeSeconds must be a non-negative finite number.');
  }
  if (audioOnly && !hasAudio) throw new TypeError('An audio-only filter graph requires audio.');

  const lines = [];
  for (const [index, range] of ranges.entries()) {
    if (!audioOnly) lines.push(`[0:v]trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v${index}]`);
    if (hasAudio) lines.push(audioSegment(range, index, joinFadeSeconds));
  }
  if (audioOnly) {
    const inputs = ranges.map((_, index) => `[a${index}]`).join('');
    lines.push(`${inputs}concat=n=${ranges.length}:v=0:a=1[a]`);
  } else if (hasAudio) {
    const inputs = ranges.map((_, index) => `[v${index}][a${index}]`).join('');
    lines.push(`${inputs}concat=n=${ranges.length}:v=1:a=1[v][a]`);
  } else {
    const videoInputs = ranges.map((_, index) => `[v${index}]`).join('');
    lines.push(`${videoInputs}concat=n=${ranges.length}:v=1:a=0[v]`);
  }
  return `${lines.join(';\n')}\n`;
}

function audioSegment(range, index, joinFadeSeconds) {
  const base = `[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS`;
  const fade = clampedFadeSeconds(range, joinFadeSeconds);
  const fadeText = formatSeconds(fade);
  if (!(fade > 0) || fadeText === '0') return `${base}[a${index}]`;
  const duration = range.end - range.start;
  const outStart = formatSeconds(duration - fade);
  return `${base},afade=t=in:d=${fadeText},afade=t=out:st=${outStart}:d=${fadeText}[a${index}]`;
}

function clampedFadeSeconds(range, joinFadeSeconds) {
  if (!(joinFadeSeconds > 0)) return 0;
  const half = (range.end - range.start) / 2;
  if (!(half > 0)) return 0;
  return Math.min(joinFadeSeconds, half);
}

function formatSeconds(value) {
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function readJoinFadeSeconds(options) {
  if (options === undefined) return 0;
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Cut render options must be an object.');
  }
  const joinFadeMs = options.joinFadeMs ?? 0;
  if (typeof joinFadeMs !== 'number' || !Number.isFinite(joinFadeMs) || joinFadeMs < 0) {
    throw new TypeError('joinFadeMs must be a non-negative finite number.');
  }
  return joinFadeMs / 1000;
}
