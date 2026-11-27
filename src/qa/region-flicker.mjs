import { spawn } from 'node:child_process';
import { probeMedia } from '../media/probe.mjs';
import { assertRectInsideFrame, resolveFrameRect } from './frame-rect.mjs';

const FLICKER_OPTIONS = new Set([
  'regions',
  'metric',
  'luminanceSpike',
  'toggleThreshold',
  'toggleNeighborRatio',
  'maxAnalysisDimension',
  'maxFrames',
  'ffmpeg',
  'signal',
]);
const REGION_ID = /^[a-z][a-z0-9-]*$/;

/** Measure named regions of a rendered video and flag flicker spikes and single-frame toggles. */
export async function inspectRegionFlicker(inputPath, options = {}) {
  const settings = normalizeFlickerOptions(options);
  if (settings.signal?.aborted) throw abortError(settings.signal);
  const media = probeMedia(inputPath);
  if (!media.width || !media.height) throw new TypeError('Flicker inspection requires video dimensions.');
  const fps = media.frameRate || media.nominalFrameRate;
  if (!fps) throw new TypeError('Flicker inspection requires a video frame rate.');

  const regions = settings.regions.map((region) => {
    const rect = resolveFrameRect(region, media.width, media.height);
    assertRectInsideFrame(rect, media.width, media.height, `Region ${region.id}`);
    return { id: region.id, rect };
  });
  const analysis = analysisSize(media.width, media.height, settings.maxAnalysisDimension);
  const decoded = await decodeGrayFrames(media.path, analysis, regions, settings, media.width, media.height);
  const reports = regions.map((region, index) => {
    const events = findRegionFlickerEvents(
      {
        luminance: decoded.luminance[index],
        consecutiveDiffs: decoded.consecutive[index],
        spanDiffs: decoded.span[index],
        fps,
      },
      settings,
    );
    return {
      id: region.id,
      rect: describeRect(region.rect, media.width, media.height),
      ...events,
    };
  });
  return {
    schemaVersion: 1,
    kind: 'region-flicker',
    source: media.path,
    width: media.width,
    height: media.height,
    fps,
    frameCount: decoded.frameCount,
    analysis,
    metric: settings.metric,
    thresholds: {
      luminanceSpike: settings.luminanceSpike,
      toggleThreshold: settings.toggleThreshold,
      toggleNeighborRatio: settings.toggleNeighborRatio,
    },
    passed: reports.every((region) => region.spikes.length === 0 && region.toggles.length === 0),
    warnings: decoded.frameCount < 3 ? ['Flicker detection needs at least 3 frames.'] : [],
    regions: reports,
  };
}

/** Flag luminance spikes and pixel A-B-A toggles in precomputed per-frame series. */
export function findRegionFlickerEvents(series, options = {}) {
  const luminance = series.luminance ?? [];
  const consecutiveDiffs = series.consecutiveDiffs ?? [];
  const spanDiffs = series.spanDiffs ?? [];
  const fps = series.fps;
  if (!Number.isFinite(fps) || fps <= 0) throw new TypeError('Flicker series fps must be positive.');
  const metric = options.metric ?? 'both';
  const luminanceSpike = options.luminanceSpike ?? 8;
  const toggleThreshold = options.toggleThreshold ?? 12;
  const toggleNeighborRatio = options.toggleNeighborRatio ?? 0.5;
  const spikes = [];
  const toggles = [];
  let maxLuminanceDelta = 0;
  let maxLuminanceDeltaFrame = 0;
  let maxPixelDelta = 0;
  let maxPixelDeltaFrame = 0;

  for (let frame = 1; frame < luminance.length; frame++) {
    const luminanceDelta = Math.abs(luminance[frame] - luminance[frame - 1]);
    if (luminanceDelta > maxLuminanceDelta) {
      maxLuminanceDelta = luminanceDelta;
      maxLuminanceDeltaFrame = frame;
    }
    const pixelDelta = consecutiveDiffs[frame];
    if (pixelDelta !== null && pixelDelta !== undefined && pixelDelta > maxPixelDelta) {
      maxPixelDelta = pixelDelta;
      maxPixelDeltaFrame = frame;
    }
  }

  if (metric !== 'pixel') {
    for (let frame = 1; frame < luminance.length - 1; frame++) {
      const before = luminance[frame] - luminance[frame - 1];
      const after = luminance[frame] - luminance[frame + 1];
      const delta = Math.min(Math.abs(before), Math.abs(after));
      if (before * after > 0 && delta > luminanceSpike) {
        spikes.push({ frame, timeSeconds: round(frame / fps, 6), delta: round(delta, 3) });
      }
    }
  }

  if (metric !== 'luminance') {
    for (let frame = 1; frame < luminance.length - 1; frame++) {
      const previous = consecutiveDiffs[frame];
      const next = consecutiveDiffs[frame + 1];
      const neighbors = spanDiffs[frame + 1];
      if (previous === null || previous === undefined || next === null || next === undefined) continue;
      if (neighbors === null || neighbors === undefined) continue;
      const delta = Math.min(previous, next);
      // A single-frame blip differs from both neighbors while those neighbors still match.
      if (delta > toggleThreshold && neighbors < toggleNeighborRatio * delta) {
        toggles.push({
          frame,
          timeSeconds: round(frame / fps, 6),
          delta: round(delta, 3),
          neighborDelta: round(neighbors, 3),
        });
      }
    }
  }

  return {
    maxLuminanceDelta: round(maxLuminanceDelta, 3),
    maxLuminanceDeltaFrame,
    maxLuminanceDeltaSeconds: round(maxLuminanceDeltaFrame / fps, 6),
    maxPixelDelta: round(maxPixelDelta, 3),
    maxPixelDeltaFrame,
    maxPixelDeltaSeconds: round(maxPixelDeltaFrame / fps, 6),
    spikes,
    toggles,
  };
}

function normalizeFlickerOptions(options) {
  assertPlainObject(options, 'Flicker options');
  assertKnownKeys(options, FLICKER_OPTIONS, 'Flicker options');
  validateSignal(options.signal);
  const metric = options.metric ?? 'both';
  if (!['luminance', 'pixel', 'both'].includes(metric))
    throw new TypeError('metric must be luminance, pixel, or both.');
  const regions = options.regions ?? [{ id: 'frame', x: 0, y: 0, width: 1, height: 1 }];
  if (!Array.isArray(regions) || regions.length === 0) throw new TypeError('regions must be a non-empty array.');
  const ids = new Set();
  for (const region of regions) {
    if (!region || typeof region !== 'object' || Array.isArray(region) || !REGION_ID.test(region.id ?? ''))
      throw new TypeError('Region ids must be kebab-case ids.');
    if (ids.has(region.id)) throw new TypeError(`Region id ${region.id} is duplicated.`);
    ids.add(region.id);
  }
  return {
    regions,
    metric,
    luminanceSpike: finiteOption(options.luminanceSpike, 8, 0, 255, 'luminanceSpike'),
    toggleThreshold: finiteOption(options.toggleThreshold, 12, 0, 255, 'toggleThreshold'),
    toggleNeighborRatio: finiteOption(options.toggleNeighborRatio, 0.5, 0, 1, 'toggleNeighborRatio'),
    maxAnalysisDimension: integerOption(options.maxAnalysisDimension, 160, 16, 640, 'maxAnalysisDimension'),
    maxFrames: integerOption(options.maxFrames, 18000, 1, 1_000_000, 'maxFrames'),
    ffmpeg: commandOption(options.ffmpeg),
    signal: options.signal,
  };
}

function analysisSize(width, height, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function decodeGrayFrames(inputPath, analysis, regions, settings, frameWidth, frameHeight) {
  const frameBytes = analysis.width * analysis.height;
  const grids = regions.map((region) =>
    mapRectToGrid(region.rect, frameWidth, frameHeight, analysis.width, analysis.height),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      settings.ffmpeg,
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-i',
        inputPath,
        '-an',
        '-sn',
        '-vf',
        `scale=${analysis.width}:${analysis.height}:flags=area,format=gray`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    const luminance = regions.map(() => []);
    const consecutive = regions.map(() => []);
    const span = regions.map(() => []);
    let pending = Buffer.alloc(0);
    let previous;
    let beforePrevious;
    let frameCount = 0;
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      settings.signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const fail = (error) => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      finish(reject, error);
    };
    const onAbort = () => fail(abortError(settings.signal));
    settings.signal?.addEventListener('abort', onAbort, { once: true });
    if (settings.signal?.aborted) onAbort();

    const pushFrame = (frame) => {
      if (frameCount >= settings.maxFrames) {
        fail(
          new Error(
            `Flicker inspection exceeded ${settings.maxFrames} frames. Raise maxFrames or inspect a shorter video.`,
          ),
        );
        return;
      }
      for (let index = 0; index < grids.length; index++) {
        luminance[index].push(mean(frame, grids[index], analysis.width, (value) => value));
        consecutive[index].push(
          previous
            ? mean(frame, grids[index], analysis.width, (value, offset) => Math.abs(value - previous[offset]))
            : null,
        );
        span[index].push(
          beforePrevious
            ? mean(frame, grids[index], analysis.width, (value, offset) => Math.abs(value - beforePrevious[offset]))
            : null,
        );
      }
      beforePrevious = previous;
      previous = frame;
      frameCount += 1;
    };

    child.stdout.on('data', (chunk) => {
      if (settled) return;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (!settled && pending.length >= frameBytes) {
        const frame = new Uint8Array(frameBytes);
        pending.copy(frame, 0, 0, frameBytes);
        pending = pending.subarray(frameBytes);
        pushFrame(frame);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8').slice(0, 4000 - stderr.length);
    });
    child.once('error', (error) => {
      fail(error.code === 'ENOENT' ? new Error('FFmpeg was not found on PATH.') : error);
    });
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(reject, new Error(`FFmpeg flicker inspection failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      if (pending.length > 0) {
        finish(reject, new Error('FFmpeg returned a partial final frame.'));
        return;
      }
      if (frameCount === 0) {
        finish(reject, new Error('FFmpeg returned no video frames.'));
        return;
      }
      finish(resolve, { luminance, consecutive, span, frameCount });
    });
  });
}

function mapRectToGrid(rect, frameWidth, frameHeight, gridWidth, gridHeight) {
  const x0 = clamp(Math.floor((rect.x / frameWidth) * gridWidth), 0, gridWidth - 1);
  const y0 = clamp(Math.floor((rect.y / frameHeight) * gridHeight), 0, gridHeight - 1);
  const x1 = clamp(Math.ceil(((rect.x + rect.width) / frameWidth) * gridWidth), x0 + 1, gridWidth);
  const y1 = clamp(Math.ceil(((rect.y + rect.height) / frameHeight) * gridHeight), y0 + 1, gridHeight);
  return { x0, y0, x1, y1 };
}

function mean(frame, grid, stride, valueAt) {
  let total = 0;
  const count = (grid.x1 - grid.x0) * (grid.y1 - grid.y0);
  for (let y = grid.y0; y < grid.y1; y++) {
    const row = y * stride;
    for (let x = grid.x0; x < grid.x1; x++) total += valueAt(frame[row + x], row + x);
  }
  return total / count;
}

function describeRect(rect, frameWidth, frameHeight) {
  return {
    x: round(rect.x, 3),
    y: round(rect.y, 3),
    width: round(rect.width, 3),
    height: round(rect.height, 3),
    fraction: {
      x: round(rect.x / frameWidth, 6),
      y: round(rect.y / frameHeight, 6),
      width: round(rect.width / frameWidth, 6),
      height: round(rect.height / frameHeight, 6),
    },
  };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} has unsupported option ${key}.`);
  }
}

function finiteOption(value, fallback, min, max, label) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < min || resolved > max)
    throw new TypeError(`${label} must be from ${min} to ${max}.`);
  return resolved;
}

function integerOption(value, fallback, min, max, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max)
    throw new TypeError(`${label} must be an integer from ${min} to ${max}.`);
  return resolved;
}

function commandOption(value) {
  const command = value ?? 'ffmpeg';
  if (typeof command !== 'string' || !command.trim()) throw new TypeError('ffmpeg must be a non-empty command path.');
  return command;
}

function validateSignal(signal) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'))
    throw new TypeError('signal must be an AbortSignal.');
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Flicker inspection cancelled.');
  error.name = 'AbortError';
  return error;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places) {
  return Number(value.toFixed(places));
}
