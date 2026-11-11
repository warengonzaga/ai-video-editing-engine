import { frameRateNumber } from './frame-rate.mjs';

export function secondsToFrame(seconds, fps, rounding = 'nearest') {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new TypeError('Time in seconds must be a non-negative finite number.');
  const rate = frameRateNumber(fps);
  const position = seconds * rate;
  const frame =
    rounding === 'nearest'
      ? Math.round(position)
      : rounding === 'floor'
        ? Math.floor(position)
        : rounding === 'ceil'
          ? Math.ceil(position)
          : NaN;
  if (!Number.isSafeInteger(frame)) throw new TypeError('Frame rounding must be nearest, floor, or ceil.');
  return frame;
}

export function frameToSeconds(frame, fps) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new TypeError('Frame must be a non-negative safe integer.');
  return frame / frameRateNumber(fps);
}

export function snapTimeToFrame(seconds, fps, rounding = 'nearest') {
  return frameToSeconds(secondsToFrame(seconds, fps, rounding), fps);
}
