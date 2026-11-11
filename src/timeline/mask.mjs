const SHAPES = new Set(['circle', 'ellipse', 'rect']);

export function validateVisualMask(mask, label = 'Visual mask') {
  if (!mask || typeof mask !== 'object' || Array.isArray(mask) || !SHAPES.has(mask.type)) {
    throw new TypeError(`${label} type must be circle, ellipse, or rect.`);
  }
  const fields =
    mask.type === 'circle'
      ? ['type', 'centerX', 'centerY', 'radius']
      : mask.type === 'ellipse'
        ? ['type', 'centerX', 'centerY', 'radiusX', 'radiusY']
        : ['type', 'x', 'y', 'width', 'height'];
  if (Object.keys(mask).some((field) => !fields.includes(field))) {
    throw new TypeError(`${label} contains unsupported fields for ${mask.type}.`);
  }
  const values = fields.filter((field) => field !== 'type').map((field) => mask[field]);
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new TypeError(`${label} values must be finite normalized numbers from 0 to 1.`);
  }
  if (mask.type === 'circle' && mask.radius <= 0) throw new TypeError(`${label} radius must be greater than 0.`);
  if (mask.type === 'ellipse' && (mask.radiusX <= 0 || mask.radiusY <= 0))
    throw new TypeError(`${label} radii must be greater than 0.`);
  if (
    mask.type === 'rect' &&
    (mask.width <= 0 || mask.height <= 0 || mask.x + mask.width > 1 || mask.y + mask.height > 1)
  ) {
    throw new TypeError(`${label} rectangle must have positive size within normalized bounds.`);
  }
  return mask;
}

export function visualMaskClipPath(mask, animated = false) {
  validateVisualMask(mask);
  if (mask.type === 'circle')
    return `circle(${animated ? scaleLength(mask.radius) : percent(mask.radius)} at ${percent(mask.centerX)} ${percent(mask.centerY)})`;
  if (mask.type === 'ellipse')
    return `ellipse(${animated ? scaleLength(mask.radiusX) : percent(mask.radiusX)} ${animated ? scaleLength(mask.radiusY) : percent(mask.radiusY)} at ${percent(mask.centerX)} ${percent(mask.centerY)})`;
  if (animated) {
    const x1 = scaleFromCenter(mask.x),
      y1 = scaleFromCenter(mask.y);
    const x2 = scaleFromCenter(mask.x + mask.width),
      y2 = scaleFromCenter(mask.y + mask.height);
    return `polygon(${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2})`;
  }
  const top = percent(mask.y);
  const right = percent(1 - mask.x - mask.width);
  const bottom = percent(1 - mask.y - mask.height);
  const left = percent(mask.x);
  return `inset(${top} ${right} ${bottom} ${left})`;
}

function scaleLength(value) {
  return `calc(${percent(value)} * var(--engine-mask-progress, 1))`;
}

function scaleFromCenter(value) {
  return `calc(50% + (${percent(value)} - 50%) * var(--engine-mask-progress, 1))`;
}

function percent(value) {
  return `${Number((value * 100).toFixed(6))}%`;
}
