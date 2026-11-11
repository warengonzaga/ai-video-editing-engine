export function validateSpeedRamp(clip) {
  const points = clip.speedRamp;
  if (!Array.isArray(points) || points.length < 2)
    throw new TypeError(`Clip ${clip.id} speedRamp must contain at least two points.`);
  if (clip.playbackRate !== undefined)
    throw new TypeError(`Clip ${clip.id} cannot combine speedRamp with playbackRate.`);
  const sourceSpan = clip.sourceOut - clip.sourceIn;
  if (points[0]?.sourceOffset !== 0 || Math.abs(points.at(-1)?.sourceOffset - sourceSpan) > 1e-6) {
    throw new TypeError(`Clip ${clip.id} speedRamp must start at sourceOffset 0 and end at the clip source span.`);
  }
  let previousOffset = -1;
  for (const [index, point] of points.entries()) {
    if (
      !point ||
      typeof point !== 'object' ||
      Array.isArray(point) ||
      !Number.isFinite(point.sourceOffset) ||
      point.sourceOffset <= previousOffset ||
      !Number.isFinite(point.playbackRate) ||
      point.playbackRate < 0.1 ||
      point.playbackRate > 5 ||
      Object.keys(point).some((key) => !['sourceOffset', 'playbackRate', 'ease'].includes(key)) ||
      (point.ease !== undefined && !SPEED_RAMP_EASES.includes(point.ease)) ||
      (index === points.length - 1 && point.ease !== undefined)
    ) {
      throw new TypeError(
        `Clip ${clip.id} speedRamp point ${index + 1} has invalid sourceOffset, playbackRate, or outgoing ease.`,
      );
    }
    previousOffset = point.sourceOffset;
  }
  const expectedDuration = speedRampDuration(points);
  if (Math.abs(expectedDuration - clip.durationSeconds) > 1e-6) {
    throw new TypeError(
      `Clip ${clip.id} durationSeconds must match its integrated speedRamp duration (${expectedDuration}).`,
    );
  }
  return points;
}

export function speedRampDuration(points, start = 0, end = points.at(-1).sourceOffset) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > points.at(-1).sourceOffset ||
    end < start
  ) {
    throw new TypeError('Speed ramp duration bounds must be a positive range within the curve.');
  }
  if (end === start) return 0;
  let duration = 0;
  for (const segment of rampSegments(points)) {
    const from = Math.max(start, segment.start.sourceOffset);
    const to = Math.min(end, segment.end.sourceOffset);
    if (to <= from) continue;
    const fromRate = speedRampRateAt(segment, from);
    const toRate = speedRampRateAt(segment, to);
    duration += integrateReciprocalRate(to - from, fromRate, toRate);
  }
  return duration;
}

export function speedRampSourceAtTime(points, timelineTime) {
  if (!Number.isFinite(timelineTime) || timelineTime < 0)
    throw new TypeError('Speed ramp timeline time must be non-negative.');
  let elapsed = 0;
  for (const segment of rampSegments(points)) {
    const sourceSpan = segment.end.sourceOffset - segment.start.sourceOffset;
    const segmentDuration = integrateReciprocalRate(sourceSpan, segment.start.playbackRate, segment.end.playbackRate);
    if (timelineTime <= elapsed + segmentDuration) {
      const deltaTime = timelineTime - elapsed;
      const slope = (segment.end.playbackRate - segment.start.playbackRate) / sourceSpan;
      const deltaSource =
        Math.abs(slope) < 1e-10
          ? deltaTime * segment.start.playbackRate
          : (segment.start.playbackRate * Math.expm1(slope * deltaTime)) / slope;
      return Math.min(segment.end.sourceOffset, segment.start.sourceOffset + Math.max(0, deltaSource));
    }
    elapsed += segmentDuration;
  }
  if (Math.abs(timelineTime - elapsed) <= 1e-6) return points.at(-1).sourceOffset;
  throw new TypeError('Speed ramp timeline time exceeds the curve duration.');
}

export function sliceSpeedRamp(points, start, end) {
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > points.at(-1).sourceOffset ||
    end <= start
  ) {
    throw new TypeError('Speed ramp slice must be a positive range within the curve.');
  }
  const expanded = expandSpeedRampPoints(points);
  const sliced = [{ sourceOffset: 0, playbackRate: speedRampRateAtOffset(expanded, start) }];
  for (const point of expanded) {
    if (point.sourceOffset > start && point.sourceOffset < end) {
      sliced.push({ sourceOffset: point.sourceOffset - start, playbackRate: point.playbackRate });
    }
  }
  sliced.push({ sourceOffset: end - start, playbackRate: speedRampRateAtOffset(expanded, end) });
  return sliced;
}

export function speedRampPtsExpression(points) {
  const segments = rampSegments(points);
  let expression = `${formatNumber(speedRampDuration(points))}+(T-${formatNumber(points.at(-1).sourceOffset)})/${formatNumber(points.at(-1).playbackRate)}`;
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    const sourceSpan = segment.end.sourceOffset - segment.start.sourceOffset;
    const slope = (segment.end.playbackRate - segment.start.playbackRate) / sourceSpan;
    const offset = `T-${formatNumber(segment.start.sourceOffset)}`;
    const elapsed =
      Math.abs(slope) < 1e-10
        ? `(${offset})/${formatNumber(segment.start.playbackRate)}`
        : `log((${formatNumber(segment.start.playbackRate)}+${formatNumber(slope)}*(${offset}))/${formatNumber(segment.start.playbackRate)})/${formatNumber(slope)}`;
    const value = `${formatNumber(speedRampDuration(points, 0, segment.start.sourceOffset))}+(${elapsed})`;
    expression = `if(lt(T\\,${formatNumber(segment.end.sourceOffset)})\\,${value}\\,${expression})`;
  }
  return `setpts=${expression}/TB`;
}

export function buildSpeedRampAudioAutomation(points, commandPath, maxSourceStep = 0.05) {
  if (!Number.isFinite(maxSourceStep) || maxSourceStep <= 0)
    throw new TypeError('Speed ramp audio command step must be positive.');
  const intervals = [];
  for (const segment of rampSegments(points)) {
    const span = segment.end.sourceOffset - segment.start.sourceOffset;
    const count = Math.ceil(span / maxSourceStep);
    for (let index = 0; index < count; index++) {
      const start = segment.start.sourceOffset + (span * index) / count;
      const end = segment.start.sourceOffset + (span * (index + 1)) / count;
      intervals.push({
        start,
        end,
        rate: speedRampRateAt(segment, (start + end) / 2),
      });
    }
  }
  const filter = 'rubberband@engine_speed_0';
  const filterInstance = `${filter}=${formatNumber(intervals[0].rate)}`;
  const commands = intervals
    .slice(1)
    .map((interval) => {
      const factor = formatNumber(interval.rate);
      return `${formatNumber(interval.start)} ${filter} tempo ${factor};`;
    })
    .join('\n');
  const commandFilter = `asendcmd=f=${commandPath}`;
  return {
    initialRate: intervals[0].rate,
    commandContents: commands,
    filters: [commandFilter, filterInstance].join(','),
  };
}

function rampSegments(points) {
  const curve = expandSpeedRampPoints(points);
  return curve.slice(1).map((end, index) => ({ start: curve[index], end }));
}

export const SPEED_RAMP_EASES = Object.freeze([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
]);
const EASE_STEPS = 64;

function expandSpeedRampPoints(points) {
  if (!points.some((point) => point.ease !== undefined && point.ease !== 'linear')) return points;
  const expanded = [{ sourceOffset: points[0].sourceOffset, playbackRate: points[0].playbackRate }];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const ease = start.ease ?? 'linear';
    const steps = ease === 'linear' ? 1 : EASE_STEPS;
    const sourceSpan = end.sourceOffset - start.sourceOffset;
    const rateSpan = end.playbackRate - start.playbackRate;
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const eased = evaluateRampEase(ease, progress);
      expanded.push({
        sourceOffset: start.sourceOffset + sourceSpan * progress,
        playbackRate: start.playbackRate + rateSpan * eased,
      });
    }
  }
  return expanded;
}

function evaluateRampEase(ease, progress) {
  switch (ease) {
    case 'easeIn':
      return progress ** 2;
    case 'easeOut':
      return 1 - (1 - progress) ** 2;
    case 'easeInOut':
      return progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
    case 'easeInCubic':
      return progress ** 3;
    case 'easeOutCubic':
      return 1 - (1 - progress) ** 3;
    case 'easeInOutCubic':
      return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    default:
      return progress;
  }
}

function speedRampRateAtOffset(points, offset) {
  const segment = rampSegments(points).find(({ end }) => offset <= end.sourceOffset) ?? rampSegments(points).at(-1);
  return speedRampRateAt(segment, offset);
}

function speedRampRateAt(segment, offset) {
  const progress = (offset - segment.start.sourceOffset) / (segment.end.sourceOffset - segment.start.sourceOffset);
  return segment.start.playbackRate + (segment.end.playbackRate - segment.start.playbackRate) * progress;
}

function integrateReciprocalRate(sourceSpan, startRate, endRate) {
  const slope = (endRate - startRate) / sourceSpan;
  return Math.abs(slope) < 1e-10 ? sourceSpan / startRate : Math.log(endRate / startRate) / slope;
}

function formatNumber(value) {
  return Number(value.toPrecision(12)).toString();
}
