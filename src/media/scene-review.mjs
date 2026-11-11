import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { runProcess } from '../render/process.mjs';
import { detectSceneChangesAsync } from './scene-detection.mjs';

const DEFAULT_THUMBNAIL_SIZE = 320;
const DEFAULT_CONTACT_SHEET_LIMIT = 60;
const DEFAULT_MAXIMUM_SHOTS = 300;
const CONTACT_SHEET_PIXEL_LIMIT = 64_000_000;

/** Create a review-ready shot map with representative frames and a contact sheet. */
export async function createSceneReviewPackAsync(inputPath, outputDirectory, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Scene review options must be an object.');
  }
  const allowedOptions = new Set([
    'threshold',
    'minimumSpacingSeconds',
    'maximumFindings',
    'maximumShots',
    'thumbnailSize',
    'contactSheetLimit',
    'columns',
    'signal',
    'onProgress',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) throw new TypeError(`Unsupported scene review option: ${key}.`);
  }
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
    throw new TypeError('onProgress must be a function.');
  }

  const output = resolve(outputDirectory);
  if (existsSync(output)) throw new Error(`Scene review output already exists: ${output}`);
  const maximumShots = options.maximumShots ?? DEFAULT_MAXIMUM_SHOTS;
  const thumbnailSize = options.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE;
  const contactSheetLimit = options.contactSheetLimit ?? DEFAULT_CONTACT_SHEET_LIMIT;
  const columns = options.columns ?? 4;
  validateIntegerRange(maximumShots, 1, 2000, 'maximumShots');
  validateIntegerRange(thumbnailSize, 80, 1280, 'thumbnailSize');
  validateIntegerRange(contactSheetLimit, 1, 120, 'contactSheetLimit');
  validateIntegerRange(columns, 1, 8, 'columns');

  emitProgress(options.onProgress, { stage: 'scene-source-fingerprint', phase: 'started' });
  const sourceSha256 = await hashFileAsync(resolve(inputPath), options.signal);
  emitProgress(options.onProgress, { stage: 'scene-source-fingerprint', phase: 'completed' });
  emitProgress(options.onProgress, { stage: 'scene-analysis', phase: 'started' });
  const analysis = await detectSceneChangesAsync(inputPath, {
    ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
    ...(options.minimumSpacingSeconds !== undefined ? { minimumSpacingSeconds: options.minimumSpacingSeconds } : {}),
    ...(options.maximumFindings !== undefined ? { maximumFindings: options.maximumFindings } : {}),
    signal: options.signal,
  });
  emitProgress(options.onProgress, { stage: 'scene-analysis', phase: 'completed', completed: 1, total: 1 });
  const shots = buildShotRanges(analysis);
  if (shots.length > maximumShots) {
    throw new RangeError(
      `Scene review found ${shots.length} shots, above maximumShots ${maximumShots}. Raise minimumSpacingSeconds or increase maximumShots.`,
    );
  }

  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(output)}-${randomUUID()}-`));
  try {
    const thumbnailDirectory = join(staging, 'thumbnails');
    await mkdir(thumbnailDirectory);
    emitProgress(options.onProgress, {
      stage: 'scene-thumbnails',
      phase: 'started',
      completed: 0,
      total: shots.length,
    });
    for (const shot of shots) {
      throwIfAborted(options.signal);
      const thumbnailName = `shot-${String(shot.index).padStart(4, '0')}.jpg`;
      const thumbnailPath = join(thumbnailDirectory, thumbnailName);
      const fit = `scale=${thumbnailSize}:${thumbnailSize}:force_original_aspect_ratio=decrease,pad=${thumbnailSize}:${thumbnailSize}:(ow-iw)/2:(oh-ih)/2:color=black`;
      await runProcess(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(shot.previewSeconds),
          '-i',
          resolve(inputPath),
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          fit,
          '-q:v',
          '3',
          thumbnailPath,
        ],
        { signal: options.signal },
      );
      if ((await stat(thumbnailPath)).size === 0)
        throw new Error(`FFmpeg produced an empty thumbnail for shot ${shot.index}.`);
      shot.thumbnail = `thumbnails/${thumbnailName}`;
      emitProgress(options.onProgress, {
        stage: 'scene-thumbnails',
        phase: 'progress',
        completed: shot.index,
        total: shots.length,
        percent: (shot.index / shots.length) * 100,
      });
    }
    emitProgress(options.onProgress, {
      stage: 'scene-thumbnails',
      phase: 'completed',
      completed: shots.length,
      total: shots.length,
    });

    const sheetShots = sampleShots(shots, contactSheetLimit);
    const sheetColumns = Math.min(columns, sheetShots.length);
    const sheetRows = Math.ceil(sheetShots.length / sheetColumns);
    const sheetWidth = sheetColumns * thumbnailSize + (sheetColumns + 1) * 12;
    const sheetHeight = sheetRows * thumbnailSize + (sheetRows + 1) * 12;
    if (sheetWidth * sheetHeight > CONTACT_SHEET_PIXEL_LIMIT) {
      throw new RangeError(
        `Contact sheet would exceed ${CONTACT_SHEET_PIXEL_LIMIT} pixels. Reduce thumbnailSize, contactSheetLimit, or columns.`,
      );
    }
    const sheetInputDirectory = join(staging, 'contact-input');
    await mkdir(sheetInputDirectory);
    for (const [index, shot] of sheetShots.entries()) {
      throwIfAborted(options.signal);
      await copyFile(
        join(staging, shot.thumbnail),
        join(sheetInputDirectory, `frame-${String(index + 1).padStart(4, '0')}.jpg`),
      );
    }
    const pattern = join(sheetInputDirectory, 'frame-%04d.jpg');
    const sheetPath = join(staging, 'contact-sheet.jpg');
    const sheetFilter = `tile=${sheetColumns}x${sheetRows}:padding=12:margin=12:color=white`;
    emitProgress(options.onProgress, { stage: 'scene-contact-sheet', phase: 'started' });
    await runProcess(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-framerate',
        '1',
        '-start_number',
        '1',
        '-i',
        pattern,
        '-vf',
        sheetFilter,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        sheetPath,
      ],
      { signal: options.signal },
    );
    if ((await stat(sheetPath)).size === 0) throw new Error('FFmpeg produced an empty scene contact sheet.');
    await rm(sheetInputDirectory, { recursive: true, force: true });
    emitProgress(options.onProgress, { stage: 'scene-contact-sheet', phase: 'completed' });

    const result = {
      schemaVersion: 2,
      sourceSha256,
      providerId: analysis.providerId,
      durationSeconds: analysis.analysis.durationSeconds,
      settings: analysis.settings,
      reviewRequired: true,
      shotCount: shots.length,
      contactSheet: 'contact-sheet.jpg',
      contactSheetShotIndexes: sheetShots.map(({ index }) => index),
      shots,
      analysis: analysis.analysis,
    };
    await writeFile(join(staging, 'scene-review.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    throwIfAborted(options.signal);
    emitProgress(options.onProgress, { stage: 'scene-review-publish', phase: 'started' });
    await rename(staging, output);
    emitProgress(options.onProgress, { stage: 'scene-review-publish', phase: 'completed' });
    return { ...result, outputDirectory: output };
  } catch (error) {
    emitProgress(options.onProgress, { stage: 'scene-review-pack', phase: 'failed', message: error.message });
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function buildShotRanges(analysis) {
  const durationSeconds = analysis?.analysis?.durationSeconds;
  const findings = analysis?.analysis?.findings;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Array.isArray(findings)) {
    throw new TypeError('Scene analysis must contain a positive duration and findings array.');
  }
  const boundaries = [
    0,
    ...findings
      .filter((finding) => finding.type === 'scene-cut')
      .map((finding) => finding.startSeconds)
      .filter((time) => Number.isFinite(time) && time > 0 && time < durationSeconds),
    durationSeconds,
  ]
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || time - all[index - 1] > 1e-6);

  return boundaries.slice(0, -1).map((startSeconds, index) => {
    const endSeconds = boundaries[index + 1];
    const previewSeconds = startSeconds + Math.min(0.5, (endSeconds - startSeconds) / 2);
    return {
      index: index + 1,
      startSeconds: round(startSeconds),
      endSeconds: round(endSeconds),
      durationSeconds: round(endSeconds - startSeconds),
      previewSeconds: round(previewSeconds),
    };
  });
}

function sampleShots(shots, limit) {
  if (shots.length <= limit) return shots;
  if (limit === 1) return [shots[0]];
  const selected = new Map();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (shots.length - 1)) / (limit - 1));
    selected.set(shots[sourceIndex].index, shots[sourceIndex]);
  }
  return [...selected.values()];
}

function validateIntegerRange(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error('Scene review cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function emitProgress(onProgress, event) {
  try {
    onProgress?.({ ...event });
  } catch {
    /* Progress observers must not interrupt media processing. */
  }
}

async function hashFileAsync(path, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

function round(value) {
  return Number(value.toFixed(6));
}
