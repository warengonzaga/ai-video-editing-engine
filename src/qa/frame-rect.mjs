/** Generic frame rectangles. Values are fractions unless unit is percent or pixel. */
export const SAFE_ZONE_PRESETS = Object.freeze({
  full: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
  'action-safe': Object.freeze({ left: 0.05, top: 0.05, right: 0.05, bottom: 0.05 }),
  'title-safe': Object.freeze({ left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 }),
  // Generic tall-frame margins for a frame near 9:16. Not a platform specification.
  'vertical-social': Object.freeze({ left: 0.06, top: 0.14, right: 0.06, bottom: 0.2 }),
});

const RECT_KEYS = new Set([
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
  'left',
  'right',
  'top',
  'bottom',
]);

export function listSafeZonePresets() {
  return Object.entries(SAFE_ZONE_PRESETS).map(([id, margins]) => ({ id, ...margins }));
}

export function resolveFrameRect(rect, frameWidth, frameHeight) {
  assertFrameSize(frameWidth, frameHeight);
  if (!rect || typeof rect !== 'object' || Array.isArray(rect))
    throw new TypeError('A frame rectangle must be an object.');
  for (const key of Object.keys(rect)) {
    if (!RECT_KEYS.has(key)) throw new TypeError(`Rectangle has unsupported field ${key}.`);
  }
  const unit = rect.unit ?? 'fraction';
  if (!['fraction', 'percent', 'pixel'].includes(unit))
    throw new TypeError('Rectangle unit must be fraction, percent, or pixel.');

  const boxKeys = ['x', 'y', 'width', 'height'];
  const edgeKeys = ['x0', 'y0', 'x1', 'y1'];
  const marginKeys = ['left', 'right', 'top', 'bottom'];
  const present = (keys) => keys.filter((key) => rect[key] !== undefined);
  const groups = [present(boxKeys), present(edgeKeys), present(marginKeys)].filter((group) => group.length > 0);
  if (groups.length !== 1 || groups[0].length !== 4) {
    throw new TypeError('A rectangle needs x/y/width/height, x0/y0/x1/y1, or left/right/top/bottom.');
  }
  const hasBox = groups[0].includes('x');
  const hasEdges = groups[0].includes('x0');

  const xOf = (value) => toPixels(value, frameWidth, unit);
  const yOf = (value) => toPixels(value, frameHeight, unit);
  let x;
  let y;
  let width;
  let height;
  if (hasBox) {
    x = xOf(rect.x);
    y = yOf(rect.y);
    width = xOf(rect.width);
    height = yOf(rect.height);
  } else if (hasEdges) {
    x = xOf(rect.x0);
    y = yOf(rect.y0);
    width = xOf(rect.x1) - x;
    height = yOf(rect.y1) - y;
  } else {
    const left = xOf(rect.left);
    const right = xOf(rect.right);
    const top = yOf(rect.top);
    const bottom = yOf(rect.bottom);
    if ([left, right, top, bottom].some((value) => value < 0))
      throw new TypeError('Rectangle margins must be non-negative.');
    x = left;
    y = top;
    width = frameWidth - left - right;
    height = frameHeight - top - bottom;
  }
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new TypeError('Rectangle width and height must be positive.');
  return { x, y, width, height };
}

export function assertRectInsideFrame(rect, frameWidth, frameHeight, label) {
  if (
    rect.x < -1e-6 ||
    rect.y < -1e-6 ||
    rect.x + rect.width > frameWidth + 1e-6 ||
    rect.y + rect.height > frameHeight + 1e-6
  ) {
    throw new TypeError(`${label} must lie inside the frame.`);
  }
}

function assertFrameSize(frameWidth, frameHeight) {
  if (!Number.isSafeInteger(frameWidth) || frameWidth <= 0 || !Number.isSafeInteger(frameHeight) || frameHeight <= 0)
    throw new TypeError('Frame width and height must be positive integers.');
}

function toPixels(value, axisSize, unit) {
  if (!Number.isFinite(value)) throw new TypeError('Rectangle values must be finite numbers.');
  if (unit === 'pixel') return value;
  if (unit === 'percent') return (value / 100) * axisSize;
  return value * axisSize;
}
