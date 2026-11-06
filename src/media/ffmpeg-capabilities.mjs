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

export function assertFfmpegEncoder(encoderName, availableEncoders) {
  if (typeof encoderName !== 'string' || !/^[a-z0-9_-]+$/i.test(encoderName)) throw new TypeError('FFmpeg encoder name is invalid.');
  if (!(availableEncoders instanceof Set)) throw new TypeError('Available FFmpeg encoders must be a Set.');
  if (!availableEncoders.has(encoderName)) {
    throw new Error(`FFmpeg encoder "${encoderName}" is unavailable in this build. Install an FFmpeg build with this encoder or select another codec.`);
  }
  return encoderName;
}

export function hasFfmpegEncoder(encoderName, ffmpeg = 'ffmpeg') {
  if (typeof encoderName !== 'string' || !/^[a-z0-9_-]+$/i.test(encoderName)) throw new TypeError('FFmpeg encoder name is invalid.');
  assertFfmpegEncoder(encoderName, listFfmpegEncoders(ffmpeg));
  return true;
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
