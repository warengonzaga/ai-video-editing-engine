const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const DEFAULTS = { tailSide: 'bottom', tailPosition: 0.16, tailSizePixels: 26, cornerRadiusPixels: 28 };

export function resolveSpeechBubble(value, base = DEFAULTS) {
  if (value === undefined) return undefined;
  const result = { ...base, ...value };
  validateSpeechBubble(result);
  return result;
}

export function validateSpeechBubble(value, label = 'Speech bubble') {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(DEFAULTS, key))
  ) {
    throw new TypeError(
      `${label} must be an object with only tailSide, tailPosition, tailSizePixels, and cornerRadiusPixels.`,
    );
  }
  if (!SIDES.has(value.tailSide)) throw new TypeError(`${label} tailSide must be top, right, bottom, or left.`);
  if (!Number.isFinite(value.tailPosition) || value.tailPosition < 0.08 || value.tailPosition > 0.92) {
    throw new TypeError(`${label} tailPosition must be from 0.08 to 0.92.`);
  }
  if (!Number.isSafeInteger(value.tailSizePixels) || value.tailSizePixels < 8 || value.tailSizePixels > 64) {
    throw new TypeError(`${label} tailSizePixels must be an integer from 8 to 64.`);
  }
  if (
    !Number.isSafeInteger(value.cornerRadiusPixels) ||
    value.cornerRadiusPixels < 0 ||
    value.cornerRadiusPixels > 128
  ) {
    throw new TypeError(`${label} cornerRadiusPixels must be an integer from 0 to 128.`);
  }
}
