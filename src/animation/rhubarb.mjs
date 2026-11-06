import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeMedia } from '../media/probe.mjs';
import { pngDimensions } from './png-image.mjs';
import { validateAnimationCues } from './cues.mjs';

const RHUBARB_SHAPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);
export const RHUBARB_SPRITE_CONTRACT = Object.freeze({
  requiredShapes: Object.freeze(['a', 'b', 'c', 'd', 'e', 'f']),
  optionalShapes: Object.freeze(['g', 'h']),
  requiredAvatarShapes: Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
  restShape: 'x',
  defaultExtendedShapes: 'GHX',
});
const DEFAULT_SPRITE_STATES = Object.freeze({
  a: 'a',
  b: 'b',
  c: 'c',
  d: 'd',
  e: 'e',
  f: 'f',
  g: 'g',
  h: 'h',
  x: 'default',
});

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
    const track = normalizeRhubarbOutput(readFileSync(cuePath, 'utf8'), media.durationSeconds);
    return settings.spriteStateMap ? mapRhubarbCuesToSpriteStates(track, settings.spriteStateMap) : track;
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

/** Map Rhubarb mouth labels to the states available in a consumer's sprite pack. */
export function mapRhubarbCuesToSpriteStates(track, mapping = DEFAULT_SPRITE_STATES) {
  validateAnimationCues(track);
  validateSpriteStateMapping(mapping);
  const cues = track.cues.map((cue) => {
    const shape = cue.state.toLowerCase();
    if (!Object.hasOwn(mapping, shape)) throw new TypeError(`No sprite state is mapped for Rhubarb shape ${shape}.`);
    return { ...cue, state: mapping[shape] };
  });
  return validateAnimationCues({ ...track, cues });
}

/** Require distinct sprite states for every Rhubarb shape enabled by the composition. */
export function validateRhubarbSpriteStates(states, options = {}) {
  if (!states || typeof states !== 'object' || Array.isArray(states)) {
    throw new TypeError('Rhubarb mouth sprites must be supplied as a state-to-image object.');
  }
  const settings = validateOptions(options);
  if (!settings.extendedShapes.includes('X')) {
    throw new TypeError('Phonetic avatar lip sync requires the X rest mouth shape.');
  }
  const mapping = settings.spriteStateMap ?? DEFAULT_SPRITE_STATES;
  const requiredShapes = [...RHUBARB_SPRITE_CONTRACT.requiredAvatarShapes, RHUBARB_SPRITE_CONTRACT.restShape];
  const requiredStates = requiredShapes.map((shape) => mapping[shape]);
  if (requiredStates.some((state) => typeof state !== 'string' || !state.trim())) {
    throw new TypeError(`Phonetic avatar lip sync requires mappings for Rhubarb shapes ${requiredShapes.join(', ')}.`);
  }
  if (new Set(requiredStates).size !== requiredStates.length) {
    throw new TypeError('Each required Rhubarb mouth shape must map to a distinct sprite state.');
  }
  const missing = requiredShapes.filter((shape, index) => !Object.hasOwn(states, requiredStates[index]));
  if (missing.length) {
    const details = missing.map((shape) => `${shape.toUpperCase()} (${mapping[shape]})`).join(', ');
    throw new TypeError(`Phonetic avatar mouth pack is incomplete. Missing sprite states for: ${details}. Required shapes: A-H and X.`);
  }
  const imageByDigest = new Map();
  let sharedDimensions;
  for (let index = 0; index < requiredStates.length; index += 1) {
    const state = requiredStates[index];
    const shape = requiredShapes[index];
    const path = states[state];
    if (typeof path !== 'string' || !path.trim() || !existsSync(resolve(path))) {
      throw new TypeError(`Phonetic avatar mouth sprite ${shape.toUpperCase()} (${state}) must point to an existing image file.`);
    }
    const imagePath = resolve(path);
    const image = readFileSync(imagePath);
    const dimensions = pngDimensions(image, `${shape.toUpperCase()} (${state})`);
    if (sharedDimensions && (dimensions.width !== sharedDimensions.width || dimensions.height !== sharedDimensions.height)) {
      throw new TypeError(`Phonetic avatar mouth sprites must share one PNG canvas. ${shape.toUpperCase()} (${state}) is ${dimensions.width}x${dimensions.height}; expected ${sharedDimensions.width}x${sharedDimensions.height}.`);
    }
    sharedDimensions ??= dimensions;
    const digest = createHash('sha256').update(image).digest('hex');
    const duplicate = imageByDigest.get(digest);
    if (duplicate) {
      throw new TypeError(`Phonetic avatar mouth pack reuses identical image data for ${duplicate.shape.toUpperCase()} (${duplicate.state}) and ${shape.toUpperCase()} (${state}); each A-H viseme and X rest requires a distinct image.`);
    }
    imageByDigest.set(digest, { shape, state });
  }
}

function validateSpriteStateMapping(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new TypeError('Rhubarb sprite-state mapping must be an object.');
  }
  for (const [shape, state] of Object.entries(mapping)) {
    if (!RHUBARB_SHAPES.has(shape.toUpperCase()) || shape !== shape.toLowerCase()
        || typeof state !== 'string' || !state.trim()) {
      throw new TypeError('Rhubarb sprite-state mappings require lowercase supported labels and non-empty state names.');
    }
  }
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Lip-sync options must be an object.');
  const allowed = new Set(['rhubarb', 'ffmpeg', 'recognizer', 'extendedShapes', 'dialogFile', 'timeoutMs', 'spriteStateMap']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`Unsupported lip-sync option: ${key}.`);
  const recognizer = options.recognizer ?? 'phonetic';
  if (!['phonetic', 'pocketSphinx'].includes(recognizer)) throw new TypeError('Rhubarb recognizer must be phonetic or pocketSphinx.');
  const extendedShapes = options.extendedShapes ?? RHUBARB_SPRITE_CONTRACT.defaultExtendedShapes;
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
  const spriteStateMap = options.spriteStateMap === undefined
    ? undefined
    : validateSpriteStateMapping(options.spriteStateMap);
  return { rhubarb, ffmpeg, recognizer, extendedShapes, dialogFile, timeoutMs, spriteStateMap };
}
