const EXTENSIONS = new Map([
  ['.mp4', 'mp4'],
  ['.webm', 'webm'],
  ['.mov', 'mov'],
  ['.gif', 'gif'],
]);

export function resolveRenderFormat(outputPath, requestedFormat) {
  if (requestedFormat === 'png-sequence') return 'png-sequence';
  const extension = outputPath ? outputPath.slice(outputPath.lastIndexOf('.')).toLowerCase() : undefined;
  const inferred = EXTENSIONS.get(extension);
  const format = requestedFormat ?? inferred ?? 'mp4';
  if (!['mp4', 'webm', 'mov', 'gif', 'png-sequence'].includes(format)) {
    throw new TypeError('Format must be mp4, webm, mov, gif, or png-sequence.');
  }
  if (requestedFormat && inferred && requestedFormat !== inferred) {
    throw new TypeError(`Output extension ${extension} does not match requested ${requestedFormat} format.`);
  }
  if (outputPath && extension && !inferred) throw new TypeError(`Unsupported render output extension: ${extension}`);
  const resolvedExtension = `.${format}`;
  if (outputPath && format !== 'png-sequence' && extension !== resolvedExtension) {
    throw new TypeError(`Render output for ${format} must use the ${resolvedExtension} extension.`);
  }
  return format;
}

export function resolveEncoderArgs(format, options = {}) {
  const encoder = resolveVideoEncoder(format, options);
  if (encoder.codec) return [];
  if (encoder.crf !== undefined) return ['--crf', String(encoder.crf)];
  if (encoder.videoBitrate !== undefined) return ['--video-bitrate', encoder.videoBitrate];
  return [];
}

export function resolveColorProfile(profile, format) {
  if (profile === undefined) return undefined;
  if (!['mp4', 'mov', 'webm'].includes(format)) {
    throw new TypeError(`Color profiles are supported for MP4, MOV, and WebM output, not ${format}.`);
  }
  const profiles = {
    'rec709': {
      id: 'rec709',
      filter: 'colorspace=iall=bt709:space=bt709:primaries=bt709:trc=bt709:range=tv',
      colorSpace: 'bt709',
      colorTransfer: 'bt709',
      colorPrimaries: 'bt709',
      colorRange: 'tv',
    },
    'rec2020-sdr': {
      id: 'rec2020-sdr',
      filter: 'colorspace=iall=bt709:space=bt2020nc:primaries=bt2020:trc=bt709:range=tv',
      colorSpace: 'bt2020nc',
      colorTransfer: 'bt709',
      colorPrimaries: 'bt2020',
      colorRange: 'tv',
    },
  };
  const resolved = profiles[profile];
  if (!resolved) throw new TypeError(`Unsupported colorProfile ${String(profile)}; choose rec709 or rec2020-sdr.`);
  return resolved;
}

export function resolveProfileEncoder(format, encoder) {
  if (encoder.codec) return encoder;
  const codecId = format === 'webm' ? 'vp9' : 'h264';
  const codec = format === 'webm' ? 'libvpx-vp9' : 'libx264';
  return { ...encoder, codecId, codec };
}

export function resolveVideoEncoder(format, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Render options must be an object.');
  for (const field of Object.keys(options)) if (!['codec', 'crf', 'videoBitrate'].includes(field)) throw new TypeError(`Unsupported encoder option: ${field}.`);
  if (options.crf !== undefined && options.videoBitrate !== undefined) throw new TypeError('Choose either crf or videoBitrate, not both.');

  const codecs = format === 'webm'
    ? { vp9: 'libvpx-vp9' }
    : format === 'mov'
      ? { h264: 'libx264', h265: 'libx265', prores: 'prores_ks' }
      : format === 'mp4'
        ? { h264: 'libx264', h265: 'libx265' }
        : {};
  if (options.codec !== undefined && (typeof options.codec !== 'string' || codecs[options.codec] === undefined)) {
    throw new TypeError(`Render codec is unsupported for ${format}; choose one of: ${Object.keys(codecs).join(', ') || 'none'}.`);
  }

  if (options.crf !== undefined) {
    if (!['mp4', 'mov', 'webm'].includes(format)) throw new TypeError(`CRF control is not supported for ${format} output.`);
    const maximum = options.codec === 'vp9' || (format === 'webm' && options.codec === undefined) ? 63 : 51;
    if (options.codec === 'prores'
        || !Number.isSafeInteger(options.crf) || options.crf < 0 || options.crf > maximum) {
      throw new TypeError(`Render crf must be an integer from 0 to ${maximum} for ${options.codec ?? format}.`);
    }
  }
  if (options.videoBitrate !== undefined && (!['mp4', 'mov', 'webm'].includes(format)
      || options.codec === 'prores'
      || typeof options.videoBitrate !== 'string'
      || !/^(?:[1-9]\d{0,5})(?:\.\d{1,2})?[KMG]?$/.test(options.videoBitrate))) {
    throw new TypeError('Render videoBitrate must be a positive bitrate such as 800K, 5M, or 1.5M on a bitrate-based encoder.');
  }

  return {
    ...(options.codec ? { codec: codecs[options.codec], codecId: options.codec } : {}),
    ...(options.crf !== undefined ? { crf: options.crf } : {}),
    ...(options.videoBitrate !== undefined ? { videoBitrate: options.videoBitrate } : {}),
  };
}

export function resolveRenderControlArgs(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Render options must be an object.');
  for (const field of Object.keys(options)) {
    if (!['format', 'encoder', 'colorProfile', 'workers', 'lowMemoryMode', 'timeoutSeconds', 'resumeCheckpoint', 'checkpointMaxBytes', 'checkpointMaxAgeHours'].includes(field)) throw new TypeError(`Unsupported render option: ${field}.`);
  }
  if (options.workers !== undefined
      && options.workers !== 'auto'
      && (!Number.isSafeInteger(options.workers) || options.workers < 1 || options.workers > 64)) {
    throw new TypeError('Render workers must be auto or an integer from 1 to 64.');
  }
  if (options.lowMemoryMode !== undefined && typeof options.lowMemoryMode !== 'boolean') {
    throw new TypeError('Render lowMemoryMode must be a boolean.');
  }
  if (options.timeoutSeconds !== undefined
      && (!Number.isSafeInteger(options.timeoutSeconds) || options.timeoutSeconds < 1 || options.timeoutSeconds > 86_400)) {
    throw new TypeError('Render timeoutSeconds must be an integer from 1 to 86400.');
  }
  if (options.resumeCheckpoint !== undefined && typeof options.resumeCheckpoint !== 'boolean') {
    throw new TypeError('Render resumeCheckpoint must be a boolean.');
  }
  if (options.checkpointMaxBytes !== undefined
      && (!Number.isSafeInteger(options.checkpointMaxBytes) || options.checkpointMaxBytes < 1024 * 1024 || options.checkpointMaxBytes > 100 * 1024 ** 3)) {
    throw new TypeError('checkpointMaxBytes must be an integer from 1048576 to 107374182400.');
  }
  if (options.checkpointMaxAgeHours !== undefined
      && (!Number.isSafeInteger(options.checkpointMaxAgeHours) || options.checkpointMaxAgeHours < 1 || options.checkpointMaxAgeHours > 720)) {
    throw new TypeError('checkpointMaxAgeHours must be an integer from 1 to 720.');
  }
  return [
    ...(options.workers !== undefined ? ['--workers', String(options.workers)] : []),
    ...(options.lowMemoryMode === true ? ['--low-memory-mode'] : options.lowMemoryMode === false ? ['--no-low-memory-mode'] : []),
  ];
}
