const TYPES = new Set(['fade', 'wipe']);
const DIRECTIONS = new Set(['left', 'right', 'up', 'down']);

export function validateClipTransition(transition, clip, label = 'Transition') {
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const fields =
    transition.type === 'wipe'
      ? ['schemaVersion', 'type', 'direction', 'durationSeconds']
      : ['schemaVersion', 'type', 'durationSeconds'];
  if (Object.keys(transition).some((field) => !fields.includes(field))) {
    throw new TypeError(`${label} contains unsupported fields.`);
  }
  if (transition.schemaVersion !== 1) throw new TypeError(`${label} schemaVersion must be 1.`);
  if (!TYPES.has(transition.type)) throw new TypeError(`${label} type must be fade or wipe.`);
  if (
    !Number.isFinite(transition.durationSeconds) ||
    transition.durationSeconds <= 0 ||
    transition.durationSeconds > clip.durationSeconds
  ) {
    throw new TypeError(`${label} durationSeconds must be positive and cannot exceed the clip duration.`);
  }
  if (transition.type === 'wipe' && !DIRECTIONS.has(transition.direction)) {
    throw new TypeError(`${label} direction must be left, right, up, or down.`);
  }
  if (transition.type === 'fade' && transition.direction !== undefined) {
    throw new TypeError(`${label} fade cannot set a direction.`);
  }
  return transition;
}

export function transitionClipPath(direction) {
  const progress = 'var(--engine-transition-progress,1)';
  if (direction === 'left') return `polygon(0 0,calc(100% * ${progress}) 0,calc(100% * ${progress}) 100%,0 100%)`;
  if (direction === 'right')
    return `polygon(calc(100% * (1 - ${progress})) 0,100% 0,100% 100%,calc(100% * (1 - ${progress})) 100%)`;
  if (direction === 'up') return `polygon(0 0,100% 0,100% calc(100% * ${progress}),0 calc(100% * ${progress}))`;
  return `polygon(0 calc(100% * (1 - ${progress})),100% calc(100% * (1 - ${progress})),100% 100%,0 100%)`;
}
