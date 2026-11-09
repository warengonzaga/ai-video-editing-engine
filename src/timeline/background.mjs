export const DEFAULT_PROJECT_BACKGROUND_COLOR = '#10141c';

export function validateProjectBackgroundColor(value, label = 'Project backgroundColor') {
  if (value !== null && (typeof value !== 'string' || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))) {
    throw new TypeError(`${label} must be a 3, 4, 6, or 8 digit hex color, or null for transparent.`);
  }
  return value;
}
