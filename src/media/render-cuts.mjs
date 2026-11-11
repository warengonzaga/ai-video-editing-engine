import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { assertEdlApproved, validateEdl } from '../edits/retime-transcript.mjs';
import { probeMedia } from './probe.mjs';

export function renderCuts(inputPath, edl, outputPath) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (input === output) throw new Error('Output path must differ from the source video.');
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  if (extname(output).toLowerCase() !== '.mp4') throw new Error('Cut output must use the .mp4 extension.');

  const media = probeMedia(input);
  validateEdl(edl, media.durationSeconds);
  assertEdlApproved(edl);
  const keepRanges = getKeepRanges(media.durationSeconds, edl.cuts);
  if (!keepRanges.length) throw new Error('EDL removes the entire source video.');

  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });
  const token = randomUUID();
  const filterPath = resolve(outputDir, `.${basename(output)}.${token}.filter.txt`);
  const temporaryOutput = resolve(outputDir, `.${basename(output, '.mp4')}.${token}.tmp.mp4`);
  const filterGraph = createFilterGraph(keepRanges, media.hasAudio);
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
      '[v]',
    ];
    if (media.hasAudio) args.push('-map', '[a]');
    else args.push('-an');
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
    if (media.hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-movflags', '+faststart', temporaryOutput);
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
    const rendered = probeMedia(output);
    const expectedDuration = keepRanges.reduce((sum, range) => sum + range.end - range.start, 0);
    if (Math.abs(rendered.durationSeconds - expectedDuration) > Math.max(0.15, 1 / (media.frameRate || 30))) {
      throw new Error(
        `Rendered duration ${rendered.durationSeconds.toFixed(3)}s does not match expected ${expectedDuration.toFixed(3)}s.`,
      );
    }
    if (media.hasAudio !== rendered.hasAudio) throw new Error('Rendered audio stream does not match the source.');
    return {
      input,
      output,
      keepRanges,
      durationSeconds: keepRanges.reduce((sum, range) => sum + range.end - range.start, 0),
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

export function createFilterGraph(ranges, hasAudio) {
  const lines = [];
  for (const [index, range] of ranges.entries()) {
    lines.push(`[0:v]trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v${index}]`);
    if (hasAudio) lines.push(`[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${index}]`);
  }
  const videoInputs = ranges.map((_, index) => `[v${index}]`).join('');
  if (hasAudio) {
    const inputs = ranges.map((_, index) => `[v${index}][a${index}]`).join('');
    lines.push(`${inputs}concat=n=${ranges.length}:v=1:a=1[v][a]`);
  } else {
    lines.push(`${videoInputs}concat=n=${ranges.length}:v=1:a=0[v]`);
  }
  return `${lines.join(';\n')}\n`;
}
