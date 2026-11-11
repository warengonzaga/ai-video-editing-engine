import { gsap } from 'gsap';

const PROPERTIES = new Set([
  'x',
  'y',
  'width',
  'height',
  'opacity',
  'rotationDegrees',
  'objectPositionX',
  'objectPositionY',
  'zoom',
  'maskProgress',
  'brightness',
  'contrast',
  'saturation',
  'blurPixels',
  'hueDegrees',
]);
const EASES = new Set([
  'none',
  'power1.in',
  'power1.out',
  'power1.inOut',
  'power2.in',
  'power2.out',
  'power2.inOut',
  'power3.in',
  'power3.out',
  'power3.inOut',
  'power4.in',
  'power4.out',
  'power4.inOut',
  'sine.in',
  'sine.out',
  'sine.inOut',
  'back.in',
  'back.out',
  'back.inOut',
]);

export function validateVisualKeyframes(track, clip) {
  if (clip.keyframes === undefined) return;
  if (track.kind !== 'video' && track.kind !== 'overlay') {
    throw new TypeError(`Clip ${clip.id} keyframes are supported on video and overlay clips.`);
  }
  if (!Array.isArray(clip.keyframes) || clip.keyframes.length === 0)
    throw new TypeError(`Clip ${clip.id} keyframes must be a non-empty array.`);
  if (clip.keyframes[0]?.time !== 0) throw new TypeError(`Clip ${clip.id} keyframes must start at time 0.`);
  if (
    clip.keyframes.some((frame) => frame?.properties?.opacity !== undefined) &&
    ((clip.fadeInSeconds ?? 0) > 0 || (clip.fadeOutSeconds ?? 0) > 0)
  ) {
    throw new TypeError(`Clip ${clip.id} cannot combine opacity keyframes with fadeInSeconds or fadeOutSeconds.`);
  }
  const hasMaskProgress = clip.keyframes.some((frame) => frame?.properties?.maskProgress !== undefined);
  if (hasMaskProgress && clip.mask === undefined)
    throw new TypeError(`Clip ${clip.id} maskProgress keyframes require a static mask.`);
  if (hasMaskProgress && clip.keyframes[0]?.properties?.maskProgress === undefined)
    throw new TypeError(`Clip ${clip.id} maskProgress keyframes must set a value at time 0.`);

  const defaults =
    track.kind === 'video' || typeof clip.text !== 'string'
      ? { x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width ?? 1, height: clip.height ?? 1 }
      : { x: clip.x ?? 0.08, y: clip.y ?? 0.76, width: clip.width ?? 0.84, height: clip.height ?? 0.16 };
  let previousTime = -1;
  const current = { ...defaults };
  for (const [index, frame] of clip.keyframes.entries()) {
    if (
      !frame ||
      typeof frame !== 'object' ||
      Array.isArray(frame) ||
      !Number.isFinite(frame.time) ||
      frame.time < 0 ||
      frame.time > clip.durationSeconds
    ) {
      throw new TypeError(`Clip ${clip.id} keyframe ${index} time must be within the clip duration.`);
    }
    if (frame.time <= previousTime) throw new TypeError(`Clip ${clip.id} keyframe times must be strictly increasing.`);
    if (
      !frame.properties ||
      typeof frame.properties !== 'object' ||
      Array.isArray(frame.properties) ||
      Object.keys(frame.properties).length === 0
    ) {
      throw new TypeError(`Clip ${clip.id} keyframe ${index} needs at least one property.`);
    }
    for (const [property, value] of Object.entries(frame.properties)) {
      if (!PROPERTIES.has(property) || !Number.isFinite(value))
        throw new TypeError(
          `Clip ${clip.id} keyframe ${index} has an unsupported or non-finite property: ${property}.`,
        );
      if (property === 'opacity' && (value < 0 || value > 1))
        throw new TypeError(`Clip ${clip.id} keyframe opacity must be between 0 and 1.`);
      if (property === 'rotationDegrees' && Math.abs(value) > 3600)
        throw new TypeError(`Clip ${clip.id} keyframe rotationDegrees must be between -3600 and 3600.`);
      if (
        ['objectPositionX', 'objectPositionY'].includes(property) &&
        (track.kind !== 'video' || value < 0 || value > 1)
      ) {
        throw new TypeError(`Clip ${clip.id} keyframe ${property} must be between 0 and 1 on a video track.`);
      }
      if (property === 'zoom' && (track.kind !== 'video' || value < 1 || value > 4)) {
        throw new TypeError(`Clip ${clip.id} keyframe zoom must be between 1 and 4 on a video track.`);
      }
      if (property === 'maskProgress' && (clip.mask === undefined || value < 0 || value > 1)) {
        throw new TypeError(
          `Clip ${clip.id} keyframe maskProgress must be between 0 and 1 and requires a static mask.`,
        );
      }
      if (['brightness', 'contrast', 'saturation'].includes(property) && (value < 0 || value > 5))
        throw new TypeError(`Clip ${clip.id} keyframe ${property} must be between 0 and 5.`);
      if (property === 'blurPixels' && (value < 0 || value > 100))
        throw new TypeError(`Clip ${clip.id} keyframe blurPixels must be between 0 and 100.`);
      if (property === 'hueDegrees' && Math.abs(value) > 360)
        throw new TypeError(`Clip ${clip.id} keyframe hueDegrees must be between -360 and 360.`);
      if (['width', 'height'].includes(property) && value <= 0)
        throw new TypeError(`Clip ${clip.id} keyframe ${property} must be positive.`);
      current[property] = value;
    }
    if (
      ![current.x, current.y, current.width, current.height].every(Number.isFinite) ||
      current.x < 0 ||
      current.y < 0 ||
      current.width <= 0 ||
      current.height <= 0 ||
      current.x + current.width > 1 ||
      current.y + current.height > 1
    ) {
      throw new TypeError(`Clip ${clip.id} keyframe placement must fit within normalized canvas bounds.`);
    }
    if (frame.ease !== undefined) validateEase(frame.ease, `Clip ${clip.id} keyframe ease`);
    if (frame.eases !== undefined) {
      if (!frame.eases || typeof frame.eases !== 'object' || Array.isArray(frame.eases))
        throw new TypeError(`Clip ${clip.id} keyframe eases must be an object.`);
      for (const [property, ease] of Object.entries(frame.eases)) {
        if (!Object.hasOwn(frame.properties, property))
          throw new TypeError(`Clip ${clip.id} keyframe ease ${property} needs a matching property.`);
        validateEase(ease, `Clip ${clip.id} keyframe ease ${property}`);
      }
    }
    previousTime = frame.time;
  }
}

export function sliceVisualKeyframes(keyframes, start, end) {
  if (!keyframes) return undefined;
  const properties = new Set(keyframes.flatMap((frame) => Object.keys(frame.properties)));
  const frames = new Map();
  const add = (time, property, value, ease) => {
    const frame = frames.get(time) ?? { time, properties: {}, eases: {} };
    frame.properties[property] = value;
    if (ease !== undefined) frame.eases[property] = ease;
    frames.set(time, frame);
  };

  for (const property of properties) {
    const points = keyframes.filter((frame) => Object.hasOwn(frame.properties, property));
    const initial = sampleProperty(points, property, start);
    if (initial !== undefined) add(0, property, initial);

    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (point.time <= start || point.time > end) continue;
      const prior = points[index - 1];
      const ease =
        prior && point.time > start
          ? sliceEase(
              point.eases?.[property] ?? point.ease ?? 'none',
              Math.max(0, (start - prior.time) / (point.time - prior.time)),
              1,
            )
          : (point.eases?.[property] ?? point.ease);
      add(point.time - start, property, point.properties[property], ease);
    }

    const ending = sampleProperty(points, property, end);
    if (ending !== undefined && !points.some((point) => point.time === end)) {
      const priorIndex = points.findLastIndex((point) => point.time < end);
      const prior = points[priorIndex];
      const next = points[priorIndex + 1];
      if (prior && next) {
        const ease = next.eases?.[property] ?? next.ease ?? 'none';
        const from = Math.max(start, prior.time);
        const to = end;
        add(
          end - start,
          property,
          ending,
          sliceEase(ease, (from - prior.time) / (next.time - prior.time), (to - prior.time) / (next.time - prior.time)),
        );
      }
    }
  }

  return [...frames.values()]
    .sort((left, right) => left.time - right.time)
    .map((frame) => {
      if (Object.keys(frame.eases).length === 0) delete frame.eases;
      return frame;
    });
}

function sampleProperty(points, property, time) {
  const priorIndex = points.findLastIndex((point) => point.time <= time);
  if (priorIndex < 0) return undefined;
  const prior = points[priorIndex];
  const next = points[priorIndex + 1];
  if (!next) return prior.properties[property];
  const progress = (time - prior.time) / (next.time - prior.time);
  const ease = next.eases?.[property] ?? next.ease ?? 'none';
  return (
    prior.properties[property] + (next.properties[property] - prior.properties[property]) * easeProgress(ease, progress)
  );
}

function sliceEase(ease, from, to) {
  if (typeof ease === 'string') {
    if (from === 0 && to === 1) return ease;
    return { type: 'range', name: ease, from, to };
  }
  return {
    type: 'range',
    name: ease.name,
    from: ease.from + (ease.to - ease.from) * from,
    to: ease.from + (ease.to - ease.from) * to,
  };
}

function easeProgress(ease, progress) {
  if (typeof ease === 'string') return gsap.parseEase(ease)(progress);
  const fn = gsap.parseEase(ease.name);
  const from = fn(ease.from),
    to = fn(ease.to);
  return (fn(ease.from + (ease.to - ease.from) * progress) - from) / (to - from);
}

function validateEase(ease, label) {
  if (typeof ease === 'string' && EASES.has(ease)) return;
  if (
    !ease ||
    typeof ease !== 'object' ||
    Array.isArray(ease) ||
    ease.type !== 'range' ||
    !EASES.has(ease.name) ||
    Object.keys(ease).some((key) => !['type', 'name', 'from', 'to'].includes(key)) ||
    !Number.isFinite(ease.from) ||
    !Number.isFinite(ease.to) ||
    ease.from < 0 ||
    ease.to > 1 ||
    ease.from >= ease.to
  ) {
    throw new TypeError(`${label} is unsupported.`);
  }
  const fn = gsap.parseEase(ease.name);
  if (Math.abs(fn(ease.to) - fn(ease.from)) < 1e-9) throw new TypeError(`${label} has no progress across its range.`);
}
