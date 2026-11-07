export const SOURCE_FIT_MODES = Object.freeze(['contain', 'cover', 'fill']);
export const DEFAULT_SOURCE_FIT = 'contain';

export function validateSourceFit(value, label = 'sourceFit') {
  if (value !== undefined && !SOURCE_FIT_MODES.includes(value)) {
    throw new TypeError(`${label} must be one of: ${SOURCE_FIT_MODES.join(', ')}.`);
  }
  return value;
}

export function resolveSourceFit(project, clip, projectDefault) {
  const fit = clip?.fit ?? project?.sourceFit ?? projectDefault ?? DEFAULT_SOURCE_FIT;
  validateSourceFit(fit, 'Resolved source fit');
  return fit;
}
