import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeMedia } from '../media/probe.mjs';
import { validateAnimationCues } from './cues.mjs';

const RHUBARB_SHAPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);

/** Generate provider-neutral mouth-shape cues with the optional Rhubarb CLI. */
export function rhubarbLipSyncCues(inputPath, options = {}) {
  const settings = validateOptions(options);
  const source = resolve(inputPath);
  const media = probeMedia(source, { requireVideo: false });
  if (!media.hasAudio) throw new TypeError('Lip-sync input must contain an audio stream.');

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'aive-rhubarb-'));
  const wavPath = join(temporaryDirectory, 'input.wav');
  const cuePath = join(temporaryDirectory, 'mouth-cues.json');
  try {
    const conversion = spawnSync(settings.ffmpeg, [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', source,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath,
    ], { encoding: 'utf8', windowsHide: true, timeout: settings.timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    if (conversion.error || conversion.status !== 0) {
      throw new Error(`Could not prepare lip-sync audio: ${conversion.error?.message ?? conversion.stderr.trim()}`);
    }

    const args = ['--exportFormat', 'json', '--recognizer', settings.recognizer, '--extendedShapes', settings.extendedShapes, '--quiet'];
    if (settings.dialogFile) args.push('--dialogFile', settings.dialogFile);
    args.push('--output', cuePath);
    args.push(wavPath);
    const generated = spawnSync(settings.rhubarb, args, {
      encoding: 'utf8', windowsHide: true, timeout: settings.timeoutMs, maxBuffer: 16 * 1024 * 1024,
    });
    if (generated.error || generated.status !== 0) {
      throw new Error(`Rhubarb lip-sync generation failed: ${generated.error?.message ?? generated.stderr.trim()}`);
    }
    if (!existsSync(cuePath)) throw new Error('Rhubarb completed without creating its cue file.');
    return normalizeRhubarbOutput(readFileSync(cuePath, 'utf8'), media.durationSeconds);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Convert Rhubarb JSON mouth cues to the Engine's lowercase animation-state contract. */
export function normalizeRhubarbOutput(input, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new TypeError('Lip-sync duration must be positive.');
  let result = input;
  if (typeof input === 'string') {
    try {
      result = JSON.parse(input);
    } catch (error) {
      throw new TypeError(`Rhubarb returned invalid JSON: ${error.message}`);
    }
  }
  if (!result || typeof result !== 'object' || !Array.isArray(result.mouthCues) || result.mouthCues.length === 0) {
    throw new TypeError('Rhubarb output must include a non-empty mouthCues array.');
  }

  const cues = result.mouthCues.map((cue) => {
    const state = typeof cue?.value === 'string' ? cue.value.toUpperCase() : '';
    if (!RHUBARB_SHAPES.has(state) || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
        || cue.start < 0 || cue.end <= cue.start || cue.end > durationSeconds + 0.02) {
      throw new TypeError('Rhubarb mouth cues must use supported shapes and valid times within the audio duration.');
    }
    return { start: cue.start, end: Math.min(cue.end, durationSeconds), state: state.toLowerCase() };
  });
  const track = { schemaVersion: 1, durationSeconds, cues };
  validateAnimationCues(track);
  return track;
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Lip-sync options must be an object.');
  const allowed = new Set(['rhubarb', 'ffmpeg', 'recognizer', 'extendedShapes', 'dialogFile', 'timeoutMs']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`Unsupported lip-sync option: ${key}.`);
  const recognizer = options.recognizer ?? 'phonetic';
  if (!['phonetic', 'pocketSphinx'].includes(recognizer)) throw new TypeError('Rhubarb recognizer must be phonetic or pocketSphinx.');
  const extendedShapes = options.extendedShapes ?? 'X';
  if (typeof extendedShapes !== 'string' || !/^(?!.*(.).*\1)[GHX]*$/.test(extendedShapes)) {
    throw new TypeError('Rhubarb extendedShapes may contain each of G, H, and X at most once.');
  }
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) throw new TypeError('Lip-sync timeoutMs must be between 1000 and 600000.');
  const rhubarb = options.rhubarb ?? 'rhubarb';
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  if (typeof rhubarb !== 'string' || !rhubarb.trim() || typeof ffmpeg !== 'string' || !ffmpeg.trim()) {
    throw new TypeError('Rhubarb and FFmpeg executable names must be non-empty strings.');
  }
  let dialogFile;
  if (options.dialogFile !== undefined) {
    if (typeof options.dialogFile !== 'string' || !options.dialogFile.trim()) throw new TypeError('dialogFile must be a non-empty path.');
    dialogFile = resolve(options.dialogFile);
    if (!existsSync(dialogFile)) throw new Error('Rhubarb dialog file does not exist.');
  }
  return { rhubarb, ffmpeg, recognizer, extendedShapes, dialogFile, timeoutMs };
}
