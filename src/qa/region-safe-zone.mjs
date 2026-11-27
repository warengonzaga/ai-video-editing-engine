import { frameRateNumber } from '../media/frame-rate.mjs';
import { sampleVisualProperty } from '../timeline/keyframes.mjs';
import { validateTimeline } from '../timeline/validate.mjs';
import { resolveFrameRect, SAFE_ZONE_PRESETS } from './frame-rect.mjs';

const SAFE_OPTIONS = new Set([
  'preset',
  'safeZone',
  'subjects',
  'clipIds',
  'boxes',
  'tolerancePixels',
  'minOpacity',
  'ignoreFullFrame',
  'fps',
]);
const BOX_KEYS = new Set([
  'id',
  'unit',
  'x',
  'y',
  'width',
  'height',
  'x0',
  'y0',
  'x1',
  'y1',
  'timeSeconds',
  'durationSeconds',
]);
const REGION_ID = /^[a-z][a-z0-9-]*$/;
const GEOMETRY = ['x', 'y', 'width', 'height', 'rotationDegrees', 'opacity'];

export { listSafeZonePresets, SAFE_ZONE_PRESETS } from './frame-rect.mjs';

/** Check timeline layers or caller boxes against a safe-zone rectangle. */
export function inspectRegionSafeZone(input, options = {}) {
  const settings = normalizeSafeZoneOptions(options);
  const source = readSafeZoneInput(input, settings);
  const safeZone = resolveSafeZone(settings, source.width, source.height);
  const violations = [];
  for (const subject of source.subjects) {
    const ranges = subjectRanges(subject, source, safeZone, settings);
    if (ranges.length === 0) continue;
    violations.push({
      id: subject.id,
      ...(subject.trackId === undefined ? {} : { trackId: subject.trackId }),
      source: subject.source,
      kind: subject.kind,
      ranges,
    });
  }
  return {
    schemaVersion: 1,
    kind: 'region-safe-zone',
    passed: violations.length === 0,
    frame: {
      width: source.width,
      height: source.height,
      ...(source.fps === undefined ? {} : { fps: source.fps }),
    },
    safeZone,
    warnings: safeZoneWarnings(settings, source.width, source.height),
    violations,
  };
}

function readSafeZoneInput(input, settings) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Safe-zone input must be a timeline or a boxes document.');
  if (Array.isArray(input.tracks) && input.project) {
    validateTimeline(input);
    const fps = frameRateNumber(input.project.fps);
    return {
      width: input.project.width,
      height: input.project.height,
      fps,
      subjects: [
        ...timelineSubjects(input, settings),
        ...boxSubjects(settings.boxes, input.project.width, input.project.height),
      ],
    };
  }
  if (
    !Number.isSafeInteger(input.width) ||
    input.width <= 0 ||
    !Number.isSafeInteger(input.height) ||
    input.height <= 0
  )
    throw new TypeError('Boxes document width and height must be positive integers.');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1)
    throw new TypeError('Boxes document schemaVersion must be 1.');
  if (settings.clipIds !== undefined) throw new TypeError('clipIds requires a timeline.');
  if (!Array.isArray(input.boxes)) throw new TypeError('Boxes document boxes must be an array.');
  const fps = resolveBoxesFps(input.fps, settings.fps);
  const boxes = [...input.boxes, ...settings.boxes];
  return {
    width: input.width,
    height: input.height,
    ...(fps === undefined ? {} : { fps }),
    subjects: boxSubjects(boxes, input.width, input.height),
  };
}

function timelineSubjects(timeline, settings) {
  const wanted = new Set(settings.clipIds ?? []);
  const found = new Set();
  const subjects = [];
  const tracks = [...timeline.tracks].sort((left, right) => left.order - right.order);
  for (const track of tracks) {
    if (track.kind === 'audio') continue;
    const clips = [...track.clips].sort(
      (left, right) =>
        left.timelineStart - right.timelineStart || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
    for (const clip of clips) {
      if (wanted.size > 0 && !wanted.has(clip.id)) continue;
      found.add(clip.id);
      if (track.visible === false || clip.enabled === false) continue;
      if (!subjectSelected(track, clip, settings.subjects)) continue;
      subjects.push({
        id: clip.id,
        trackId: track.id,
        source: 'timeline',
        kind: track.kind === 'overlay' && typeof clip.text === 'string' ? 'text' : track.kind,
        start: clip.timelineStart,
        duration: clip.durationSeconds,
        track,
        clip,
      });
    }
  }
  for (const id of wanted) {
    if (!found.has(id)) throw new TypeError(`Unknown clip id: ${id}.`);
  }
  return subjects;
}

function rectangleWithoutTiming(box) {
  const rect = { ...box };
  delete rect.timeSeconds;
  delete rect.durationSeconds;
  return rect;
}

function boxSubjects(boxes, frameWidth, frameHeight) {
  const ids = new Set();
  return boxes.map((box) => {
    assertPlainObject(box, 'Safe-zone box');
    for (const key of Object.keys(box)) {
      if (!BOX_KEYS.has(key)) throw new TypeError(`Safe-zone box has unsupported field ${key}.`);
    }
    if (!REGION_ID.test(box.id ?? '')) throw new TypeError('Safe-zone box ids must be kebab-case ids.');
    if (ids.has(box.id)) throw new TypeError(`Safe-zone box id ${box.id} is duplicated.`);
    ids.add(box.id);
    const timeSeconds = box.timeSeconds ?? 0;
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
      throw new TypeError(`Box ${box.id} timeSeconds must be non-negative.`);
    if (box.durationSeconds !== undefined && (!Number.isFinite(box.durationSeconds) || box.durationSeconds <= 0)) {
      throw new TypeError(`Box ${box.id} durationSeconds must be positive.`);
    }
    return {
      id: box.id,
      source: 'box',
      kind: 'box',
      start: timeSeconds,
      duration: box.durationSeconds,
      rect: resolveFrameRect(rectangleWithoutTiming(box), frameWidth, frameHeight),
    };
  });
}

function subjectRanges(subject, source, safeZone, settings) {
  if (subject.source === 'box') {
    const sample = { time: subject.start, box: subject.rect, opacity: 1 };
    if (settings.ignoreFullFrame && coversFrame(sample.box, source.width, source.height, settings.tolerancePixels))
      return [];
    const edges = violationEdges(sample.box, safeZone.pixels, settings.tolerancePixels);
    if (edges.length === 0) return [];
    const end = subject.duration === undefined ? subject.start : subject.start + subject.duration;
    return [rangeFrom(subject.start, end, sample.box, edges, source.fps)];
  }

  const samples = geometrySamples(subject, source);
  const violations = [];
  for (const sample of samples) {
    if (sample.opacity < settings.minOpacity) continue;
    if (settings.ignoreFullFrame && coversFrame(sample.box, source.width, source.height, settings.tolerancePixels))
      continue;
    const edges = violationEdges(sample.box, safeZone.pixels, settings.tolerancePixels);
    if (edges.length === 0) continue;
    violations.push({ ...sample, edges });
  }
  if (violations.length === 0) return [];
  if (!geometryVaries(subject.clip)) {
    const sample = violations[0];
    return [rangeFrom(subject.start, subject.start + subject.duration, sample.box, sample.edges, source.fps)];
  }
  return mergeSamples(violations, source.fps);
}

function geometrySamples(subject, source) {
  const times = geometryVaries(subject.clip)
    ? frameTimes(subject.start, subject.duration, source.fps)
    : [subject.start];
  return times.map((time) => sampleSubject(subject, time, source.width, source.height));
}

function sampleSubject(subject, time, frameWidth, frameHeight) {
  const localTime = Math.max(0, time - subject.start);
  const text = subject.track.kind === 'overlay' && typeof subject.clip.text === 'string';
  const defaults = text
    ? {
        x: subject.clip.x ?? 0.08,
        y: subject.clip.y ?? 0.76,
        width: subject.clip.width ?? 0.84,
        height: subject.clip.height ?? 0.16,
      }
    : {
        x: subject.clip.x ?? 0,
        y: subject.clip.y ?? 0,
        width: subject.clip.width ?? 1,
        height: subject.clip.height ?? 1,
      };
  const sample = (property, fallback) => sampleVisualProperty(subject.clip.keyframes, property, localTime, fallback);
  return {
    time,
    opacity: sample('opacity', 1),
    box: axisAlignedBounds(
      {
        x: sample('x', defaults.x) * frameWidth,
        y: sample('y', defaults.y) * frameHeight,
        width: sample('width', defaults.width) * frameWidth,
        height: sample('height', defaults.height) * frameHeight,
      },
      sample('rotationDegrees', 0),
    ),
  };
}

function frameTimes(start, duration, fps) {
  const end = start + duration;
  const times = [];
  const first = Math.ceil(start * fps - 1e-9);
  const last = Math.floor(end * fps + 1e-9);
  for (let frame = first; frame <= last; frame++) {
    const time = frame / fps;
    if (time + 1e-9 >= start && time <= end + 1e-9) times.push(time);
  }
  return times.length > 0 ? times : [start];
}

function geometryVaries(clip) {
  const seen = new Map();
  for (const frame of clip.keyframes ?? []) {
    for (const property of GEOMETRY) {
      if (frame?.properties?.[property] === undefined) continue;
      const value = frame.properties[property];
      if (!seen.has(property)) seen.set(property, value);
      else if (seen.get(property) !== value) return true;
    }
  }
  return false;
}

function axisAlignedBounds(rect, rotationDegrees) {
  if (!rotationDegrees) return rect;
  const radians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return [centerX + dx * cosine - dy * sine, centerY + dx * sine + dy * cosine];
  });
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function mergeSamples(samples, fps) {
  const ranges = [];
  for (const sample of samples) {
    const frame = fps === undefined ? undefined : Math.round(sample.time * fps);
    const previous = ranges.at(-1);
    const adjacent = previous && frame !== undefined && frame === previous.endFrame + 1;
    if (previous && adjacent && sameEdges(previous.edges, sample.edges)) {
      previous.endFrame = frame;
      previous.endSeconds = round(sample.time, 6);
      const endBox = roundBox(sample.box);
      if (!sameBox(previous.box, endBox)) previous.endBox = endBox;
      continue;
    }
    ranges.push(rangeFrom(sample.time, sample.time, sample.box, sample.edges, fps));
  }
  return ranges;
}

function rangeFrom(start, end, box, edges, fps) {
  const range = {
    startSeconds: round(start, 6),
    endSeconds: round(end, 6),
    edges: [...edges],
    box: roundBox(box),
  };
  if (fps !== undefined) {
    range.startFrame = Math.round(start * fps);
    range.endFrame = Math.round(end * fps);
  }
  return range;
}

function coversFrame(box, width, height, tolerance) {
  return (
    box.x <= tolerance &&
    box.y <= tolerance &&
    box.x + box.width >= width - tolerance &&
    box.y + box.height >= height - tolerance
  );
}

function violationEdges(box, safe, tolerance) {
  const edges = [];
  if (box.x < safe.x - tolerance) edges.push('left');
  if (box.y < safe.y - tolerance) edges.push('top');
  if (box.x + box.width > safe.x + safe.width + tolerance) edges.push('right');
  if (box.y + box.height > safe.y + safe.height + tolerance) edges.push('bottom');
  return edges;
}

function resolveSafeZone(settings, frameWidth, frameHeight) {
  const explicit = settings.safeZone ? resolveFrameRect(settings.safeZone, frameWidth, frameHeight) : null;
  const preset = explicit ? null : (settings.preset ?? 'title-safe');
  const margins = explicit ? null : SAFE_ZONE_PRESETS[preset];
  if (!explicit && !margins) throw new TypeError(`Unknown safe-zone preset: ${settings.preset}.`);
  const pixels = explicit ?? resolveFrameRect({ ...margins, unit: 'fraction' }, frameWidth, frameHeight);
  const rect = {
    x: pixels.x / frameWidth,
    y: pixels.y / frameHeight,
    width: pixels.width / frameWidth,
    height: pixels.height / frameHeight,
  };
  return {
    preset,
    margins: {
      left: round(rect.x, 6),
      top: round(rect.y, 6),
      right: round(1 - (rect.x + rect.width), 6),
      bottom: round(1 - (rect.y + rect.height), 6),
    },
    rect: {
      x: round(rect.x, 6),
      y: round(rect.y, 6),
      width: round(rect.width, 6),
      height: round(rect.height, 6),
    },
    pixels: roundBox(pixels),
  };
}

function safeZoneWarnings(settings, width, height) {
  if ((settings.safeZone ? null : (settings.preset ?? 'title-safe')) !== 'vertical-social') return [];
  const aspect = width / height;
  const target = 9 / 16;
  if (Math.abs(aspect - target) / target <= 0.08) return [];
  return ['vertical-social margins are intended for a tall frame near 9:16. Pass safeZone to use different margins.'];
}

function resolveBoxesFps(documentFps, optionFps) {
  const value = optionFps ?? documentFps;
  if (value === undefined) return undefined;
  return frameRateNumber(value);
}

function subjectSelected(track, clip, subjects) {
  if (subjects === 'all') return true;
  if (subjects === 'overlays') return track.kind === 'overlay';
  if (subjects === 'text') return track.kind === 'overlay' && typeof clip.text === 'string';
  throw new TypeError('subjects must be overlays, text, or all.');
}

function normalizeSafeZoneOptions(options) {
  assertPlainObject(options, 'Safe-zone options');
  assertKnownKeys(options, SAFE_OPTIONS, 'Safe-zone options');
  const subjects = options.subjects ?? 'overlays';
  if (!['overlays', 'text', 'all'].includes(subjects)) throw new TypeError('subjects must be overlays, text, or all.');
  if (options.preset !== undefined && (typeof options.preset !== 'string' || !SAFE_ZONE_PRESETS[options.preset]))
    throw new TypeError(`Unknown safe-zone preset: ${options.preset}.`);
  if (
    options.clipIds !== undefined &&
    (!Array.isArray(options.clipIds) || options.clipIds.some((id) => typeof id !== 'string'))
  )
    throw new TypeError('clipIds must be an array of clip ids.');
  if (options.boxes !== undefined && !Array.isArray(options.boxes)) throw new TypeError('boxes must be an array.');
  const tolerancePixels = options.tolerancePixels ?? 0.5;
  if (!Number.isFinite(tolerancePixels) || tolerancePixels < 0)
    throw new TypeError('tolerancePixels must be non-negative.');
  const minOpacity = options.minOpacity ?? 0.02;
  if (!Number.isFinite(minOpacity) || minOpacity < 0 || minOpacity > 1)
    throw new TypeError('minOpacity must be from 0 to 1.');
  if (options.ignoreFullFrame !== undefined && typeof options.ignoreFullFrame !== 'boolean')
    throw new TypeError('ignoreFullFrame must be a boolean.');
  if (options.fps !== undefined) frameRateNumber(options.fps);
  return {
    preset: options.preset,
    safeZone: options.safeZone,
    subjects,
    clipIds: options.clipIds,
    boxes: options.boxes ?? [],
    tolerancePixels,
    minOpacity,
    ignoreFullFrame: options.ignoreFullFrame ?? true,
    fps: options.fps,
  };
}

function sameEdges(left, right) {
  return left.length === right.length && left.every((edge, index) => edge === right[index]);
}

function sameBox(left, right) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function roundBox(box) {
  return {
    x: round(box.x, 3),
    y: round(box.y, 3),
    width: round(box.width, 3),
    height: round(box.height, 3),
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

function round(value, places) {
  return Number(value.toFixed(places));
}
