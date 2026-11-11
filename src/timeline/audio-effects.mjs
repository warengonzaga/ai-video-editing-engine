const EFFECT_TYPES = new Set(['equalizer', 'highpass', 'lowpass', 'compressor', 'denoise', 'balance']);

export function validateAudioClipEffects(effects, clipId) {
  if (effects === undefined) return;
  if (!Array.isArray(effects) || effects.length > 16) {
    throw new TypeError(`Clip ${clipId} audioEffects must be an array with at most 16 effects.`);
  }
  for (const [index, effect] of effects.entries()) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect) || !EFFECT_TYPES.has(effect.type)) {
      throw new TypeError(`Clip ${clipId} audio effect ${index + 1} has an unsupported type.`);
    }
    const fields = {
      equalizer: ['type', 'frequencyHz', 'gainDB', 'q'],
      highpass: ['type', 'frequencyHz', 'order'],
      lowpass: ['type', 'frequencyHz', 'order'],
      compressor: ['type', 'thresholdDB', 'ratio', 'attackMs', 'releaseMs', 'makeupDB'],
      denoise: ['type', 'reductionDB'],
      balance: ['type', 'value'],
    }[effect.type];
    if (Object.keys(effect).some((field) => !fields.includes(field))) {
      throw new TypeError(`Clip ${clipId} audio effect ${index + 1} has unsupported settings.`);
    }
    if (effect.type === 'equalizer') {
      requireRange(effect.frequencyHz, 20, 20000, `Clip ${clipId} equalizer frequencyHz`);
      requireRange(effect.gainDB, -18, 18, `Clip ${clipId} equalizer gainDB`);
      if (effect.q !== undefined) requireRange(effect.q, 0.1, 10, `Clip ${clipId} equalizer q`);
    } else if (effect.type === 'highpass' || effect.type === 'lowpass') {
      requireRange(effect.frequencyHz, 20, 20000, `Clip ${clipId} ${effect.type} frequencyHz`);
      if (effect.order !== undefined && (!Number.isSafeInteger(effect.order) || effect.order < 1 || effect.order > 2)) {
        throw new TypeError(`Clip ${clipId} ${effect.type} order must be 1 or 2.`);
      }
    } else if (effect.type === 'compressor') {
      requireRange(effect.thresholdDB, -60, 0, `Clip ${clipId} compressor thresholdDB`);
      requireRange(effect.ratio, 1, 20, `Clip ${clipId} compressor ratio`);
      requireRange(effect.attackMs ?? 20, 0.01, 200, `Clip ${clipId} compressor attackMs`);
      requireRange(effect.releaseMs ?? 250, 1, 2000, `Clip ${clipId} compressor releaseMs`);
      requireRange(effect.makeupDB ?? 0, 0, 24, `Clip ${clipId} compressor makeupDB`);
    } else if (effect.type === 'denoise') {
      requireRange(effect.reductionDB, 0.01, 30, `Clip ${clipId} denoise reductionDB`);
    } else {
      requireRange(effect.value, -1, 1, `Clip ${clipId} stereo balance`);
    }
  }
}

export function buildAudioClipEffectFilters(effects = []) {
  return effects.map((effect) => {
    if (effect.type === 'equalizer')
      return `equalizer=f=${effect.frequencyHz}:t=q:w=${effect.q ?? 1}:g=${effect.gainDB}`;
    if (effect.type === 'highpass' || effect.type === 'lowpass')
      return `${effect.type}=f=${effect.frequencyHz}:p=${effect.order ?? 2}`;
    if (effect.type === 'compressor') {
      return `acompressor=threshold=${10 ** ((effect.thresholdDB ?? -18) / 20)}:ratio=${effect.ratio}:attack=${effect.attackMs ?? 20}:release=${effect.releaseMs ?? 250}:makeup=${10 ** ((effect.makeupDB ?? 0) / 20)}:detection=rms`;
    }
    if (effect.type === 'denoise') return `afftdn=nr=${effect.reductionDB}`;
    return `stereotools=balance_in=${effect.value}`;
  });
}

export function audioClipEffectRequirements(effects = []) {
  const requirements = new Set();
  for (const effect of effects) {
    if (effect.type === 'equalizer') requirements.add('equalizer');
    if (effect.type === 'highpass') requirements.add('highpass');
    if (effect.type === 'lowpass') requirements.add('lowpass');
    if (effect.type === 'compressor') requirements.add('acompressor');
    if (effect.type === 'denoise') requirements.add('afftdn');
    if (effect.type === 'balance') requirements.add('stereotools');
  }
  return [...requirements];
}

function requireRange(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be from ${minimum} to ${maximum}.`);
  }
}
