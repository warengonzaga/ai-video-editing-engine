import { spawnSync } from 'node:child_process';

export function parseFfmpegFilters(output) {
  if (typeof output !== 'string') throw new TypeError('FFmpeg filter output must be text.');
  return new Set(output.split(/\r?\n/).flatMap((line) => {
    const [flags, name, inputOutput] = line.trim().split(/\s+/, 3);
    return flags && /^[TSC.]{2,3}$/.test(flags) && name && inputOutput?.includes('->') ? [name] : [];
  }));
}

export function hasFfmpegFilter(filterName, ffmpeg = 'ffmpeg') {
  if (typeof filterName !== 'string' || !/^[a-z0-9_]+$/.test(filterName)) throw new TypeError('FFmpeg filter name is invalid.');
  return listFfmpegFilters(ffmpeg).has(filterName);
}

export function listFfmpegFilters(ffmpeg = 'ffmpeg') {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-filters'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not inspect FFmpeg filters: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return parseFfmpegFilters(result.stdout);
}

export function parseFfmpegEncoders(output) {
  if (typeof output !== 'string') throw new TypeError('FFmpeg encoder output must be text.');
  return new Set(output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^[A-Z.]{6}\s+([a-z0-9_-]+)\s+/i);
    return match ? [match[1]] : [];
  }));
}

export function parseFfmpegDecoders(output) {
  if (typeof output !== 'string') throw new TypeError('FFmpeg decoder output must be text.');
  return new Set(output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^[A-Z.]{6}\s+([a-z0-9_-]+)\s+/i);
    return match ? [match[1]] : [];
  }));
}

export function parseFfmpegDemuxers(output) {
  if (typeof output !== 'string') throw new TypeError('FFmpeg demuxer output must be text.');
  return new Set(output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^D\s+([a-z0-9_,]+)\s+/i);
    return match ? match[1].split(',').map((name) => name.trim()).filter(Boolean) : [];
  }));
}

export function assertFfmpegEncoder(encoderName, availableEncoders) {
  if (typeof encoderName !== 'string' || !/^[a-z0-9_-]+$/i.test(encoderName)) throw new TypeError('FFmpeg encoder name is invalid.');
  if (!(availableEncoders instanceof Set)) throw new TypeError('Available FFmpeg encoders must be a Set.');
  if (!availableEncoders.has(encoderName)) {
    throw new Error(`FFmpeg encoder "${encoderName}" is unavailable in this build. Install an FFmpeg build with this encoder or select another codec.`);
  }
  return encoderName;
}

export function assertFfmpegDecoder(decoderName, availableDecoders) {
  if (typeof decoderName !== 'string' || !/^[a-z0-9_-]+$/i.test(decoderName)) throw new TypeError('FFmpeg decoder name is invalid.');
  if (!(availableDecoders instanceof Set)) throw new TypeError('Available FFmpeg decoders must be a Set.');
  if (!availableDecoders.has(decoderName)) {
    throw new Error(`FFmpeg decoder "${decoderName}" is unavailable in this build. Install an FFmpeg build with this decoder or choose another input format.`);
  }
  return decoderName;
}

export function assertFfmpegDemuxer(demuxerName, availableDemuxers) {
  if (typeof demuxerName !== 'string' || !/^[a-z0-9_]+$/i.test(demuxerName)) throw new TypeError('FFmpeg demuxer name is invalid.');
  if (!(availableDemuxers instanceof Set)) throw new TypeError('Available FFmpeg demuxers must be a Set.');
  if (!availableDemuxers.has(demuxerName)) {
    throw new Error(`FFmpeg demuxer "${demuxerName}" is unavailable in this build. Install an FFmpeg build with this demuxer or choose another container.`);
  }
  return demuxerName;
}

export function hasFfmpegEncoder(encoderName, ffmpeg = 'ffmpeg') {
  if (typeof encoderName !== 'string' || !/^[a-z0-9_-]+$/i.test(encoderName)) throw new TypeError('FFmpeg encoder name is invalid.');
  assertFfmpegEncoder(encoderName, listFfmpegEncoders(ffmpeg));
  return true;
}

export function hasFfmpegDecoder(decoderName, ffmpeg = 'ffmpeg') {
  if (typeof decoderName !== 'string' || !/^[a-z0-9_-]+$/i.test(decoderName)) throw new TypeError('FFmpeg decoder name is invalid.');
  return listFfmpegDecoders(ffmpeg).has(decoderName);
}

export function hasFfmpegDemuxer(demuxerName, ffmpeg = 'ffmpeg') {
  if (typeof demuxerName !== 'string' || !/^[a-z0-9_]+$/i.test(demuxerName)) throw new TypeError('FFmpeg demuxer name is invalid.');
  return listFfmpegDemuxers(ffmpeg).has(demuxerName);
}

export function listFfmpegEncoders(ffmpeg = 'ffmpeg') {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not inspect FFmpeg encoders: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return parseFfmpegEncoders(result.stdout);
}

export function listFfmpegDecoders(ffmpeg = 'ffmpeg') {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-decoders'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not inspect FFmpeg decoders: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return parseFfmpegDecoders(result.stdout);
}

export function listFfmpegDemuxers(ffmpeg = 'ffmpeg') {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-demuxers'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not inspect FFmpeg demuxers: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return parseFfmpegDemuxers(result.stdout);
}
