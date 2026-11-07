import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeMedia, probeMediaAsync } from '../media/probe.mjs';
import { runProcess } from '../render/process.mjs';
import { pngDimensions } from './png-image.mjs';
import { validateAnimationCues } from './cues.mjs';

const RHUBARB_SHAPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);
export const RHUBARB_SPRITE_CONTRACT = Object.freeze({
  requiredShapes: Object.freeze(['a', 'b', 'c', 'd', 'e', 'f']),
  optionalShapes: Object.freeze(['g', 'h']),
  requiredAvatarShapes: Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
  restShape: 'x',
  defaultExtendedShapes: 'GHX',
  mouthTransition: Object.freeze({
    method: 'crossfade',
    defaultSeconds: 0.06,
    minimumSeconds: 0,
    maximumSeconds: 0.25,
  }),
  mouthArtworkGuidance: Object.freeze({
    layerPlacement: 'Keep one fixed layer position and size for every mouth state.',
    artworkAnchor: 'Align the upper-lip center and mouth centerline to the same normalized canvas coordinates in every state.',
    jawMotion: 'Keep the upper lip anchored and extend more-open jaw shapes downward instead of shifting the whole mouth upward or sideways.',
    faceDirection: 'Keep the face and glasses front-facing; express pointing direction with the eyes or pose layer, not by moving the mouth.',
  }),
  animationArtworkGuidance: Object.freeze({
    blinking: 'Use a dedicated eyes layer for blink states; keep the body sprite unchanged during a blink to avoid whole-avatar flicker.',
    poseChanges: 'When body pose states change, preserve the same canvas, framing, scale, and body anchor across every state.',
  }),
  mouthVisualReviewChecklist: Object.freeze([
    'Confirm the upper-lip center and mouth centerline stay aligned across A-H and X.',
    'Confirm teeth, tongue, outlines, palette, and shading remain consistent across states.',
    'Confirm crossfades do not create visible double outlines or conflicting teeth.',
    'Confirm each drawing reads as its intended Rhubarb articulation.',
    'Watch the states as a sequence with the target audio and review cue timing.',
  ]),
  mouthShapeGuidance: Object.freeze({
    a: Object.freeze({ articulation: 'closed with gentle lip pressure', sounds: ['P', 'B', 'M'], role: 'bilabial closure' }),
    b: Object.freeze({ articulation: 'slightly open with teeth close together', sounds: ['K', 'S', 'T', 'EE'], role: 'consonants and narrow vowels' }),
    c: Object.freeze({ articulation: 'open, medium width', sounds: ['EH', 'AE'], role: 'medium-open vowel and in-between toward D' }),
    d: Object.freeze({ articulation: 'widest open jaw', sounds: ['AA'], role: 'wide-open vowel' }),
    e: Object.freeze({ articulation: 'slightly rounded; no wider than C', sounds: ['AO', 'ER'], role: 'rounded vowel and in-between toward F' }),
    f: Object.freeze({ articulation: 'strongly puckered lips', sounds: ['UW', 'OW', 'W'], role: 'rounded or puckered vowel' }),
    g: Object.freeze({ articulation: 'upper teeth touch lower lip', sounds: ['F', 'V'], role: 'labiodental consonant; optional extended shape' }),
    h: Object.freeze({ articulation: 'raised tongue behind upper teeth; medium-open jaw', sounds: ['L'], role: 'long L; optional extended shape' }),
    x: Object.freeze({ articulation: 'closed, relaxed lips', sounds: [], role: 'idle and pause rest position' }),
  }),
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
    let dialogFile = settings.dialogFile;
    if (settings.dialogText !== undefined) {
      dialogFile = join(temporaryDirectory, 'dialog.txt');
      writeFileSync(dialogFile, settings.dialogText, 'utf8');
    }
    if (dialogFile) args.push('--dialogFile', dialogFile);
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

/** Generate Rhubarb mouth cues without blocking the event loop; abort cancels child processes. */
export async function rhubarbLipSyncCuesAsync(inputPath, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Lip-sync options must be an object.');
  const { signal, ...rhubarbOptions } = options;
  const settings = validateOptions(rhubarbOptions);
  const source = resolve(inputPath);
  validateAbortSignal(signal);
  throwIfAborted(signal);
  const probeSignal = createTimedSignal(signal, settings.timeoutMs);
  const media = await probeMediaAsync(source, { requireVideo: false, signal: probeSignal });
  if (!media.hasAudio) throw new TypeError('Lip-sync input must contain an audio stream.');

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'aive-rhubarb-'));
  const wavPath = join(temporaryDirectory, 'input.wav');
  const cuePath = join(temporaryDirectory, 'mouth-cues.json');
  try {
    throwIfAborted(signal);
    const conversionSignal = createTimedSignal(signal, settings.timeoutMs);
    try {
      await runProcess(settings.ffmpeg, [
        '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', source,
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath,
      ], { signal: conversionSignal, stdio: 'capture' });
    } catch (error) {
      if (conversionSignal.aborted) throw conversionSignal.reason ?? error;
      throw new Error(`Could not prepare lip-sync audio: ${error.message}`);
    }

    const args = ['--exportFormat', 'json', '--recognizer', settings.recognizer, '--extendedShapes', settings.extendedShapes, '--quiet'];
    let dialogFile = settings.dialogFile;
    if (settings.dialogText !== undefined) {
      dialogFile = join(temporaryDirectory, 'dialog.txt');
      await writeFile(dialogFile, settings.dialogText, 'utf8');
    }
    if (dialogFile) args.push('--dialogFile', dialogFile);
    args.push('--output', cuePath);
    args.push(wavPath);
    throwIfAborted(signal);
    const rhubarbSignal = createTimedSignal(signal, settings.timeoutMs);
    try {
      await runProcess(settings.rhubarb, args, { signal: rhubarbSignal, stdio: 'capture' });
    } catch (error) {
      if (rhubarbSignal.aborted) throw rhubarbSignal.reason ?? error;
      throw new Error(`Rhubarb lip-sync generation failed: ${error.message}`);
    }
    throwIfAborted(signal);
    const output = await readFile(cuePath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw new Error('Rhubarb completed without creating its cue file.');
      throw error;
    });
    const track = normalizeRhubarbOutput(output, media.durationSeconds);
    return settings.spriteStateMap ? mapRhubarbCuesToSpriteStates(track, settings.spriteStateMap) : track;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function createTimedSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function validateAbortSignal(signal) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Lip-sync signal must be an AbortSignal.');
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
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
  return {
    valid: true,
    shapeStates: Object.fromEntries(requiredShapes.map((shape, index) => [shape.toUpperCase(), requiredStates[index]])),
    canvas: sharedDimensions,
    visualReviewRequired: true,
    visualReviewChecklist: RHUBARB_SPRITE_CONTRACT.mouthVisualReviewChecklist,
  };
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
  const allowed = new Set(['rhubarb', 'ffmpeg', 'recognizer', 'extendedShapes', 'dialogFile', 'dialogText', 'timeoutMs', 'spriteStateMap']);
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
  let dialogText;
  if (options.dialogFile !== undefined) {
    if (typeof options.dialogFile !== 'string' || !options.dialogFile.trim()) throw new TypeError('dialogFile must be a non-empty path.');
    dialogFile = resolve(options.dialogFile);
    if (!existsSync(dialogFile)) throw new Error('Rhubarb dialog file does not exist.');
  }
  if (options.dialogText !== undefined) {
    if (typeof options.dialogText !== 'string' || !options.dialogText.trim()) throw new TypeError('dialogText must be a non-empty string.');
    if (dialogFile) throw new TypeError('Specify either dialogText or dialogFile, not both.');
    dialogText = options.dialogText;
  }
  const spriteStateMap = options.spriteStateMap === undefined
    ? undefined
    : validateSpriteStateMapping(options.spriteStateMap);
  return { rhubarb, ffmpeg, recognizer, extendedShapes, dialogFile, dialogText, timeoutMs, spriteStateMap };
}
