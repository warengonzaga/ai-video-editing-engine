import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function probeMedia(inputPath, { requireVideo = true } = {}) {
  const path = resolve(inputPath);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Media file not found: ${path}`);
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return parseProbeOutput(result.stdout, path, { requireVideo });
}

export function parseProbeOutput(output, path = '', { requireVideo = true } = {}) {
  let info;
  try {
    info = JSON.parse(output);
  } catch (error) {
    throw new TypeError(`Invalid ffprobe JSON: ${error.message}`);
  }
  const durationSeconds = Number(info.format?.duration);
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('Media must have a finite positive duration.');
  }
  if (requireVideo && !video) throw new TypeError('Media must contain a video stream.');
  if (!video && !audio) throw new TypeError('Media must contain a video or audio stream.');
  return {
    path,
    durationSeconds,
    width: Number(video?.width) || null,
    height: Number(video?.height) || null,
    frameRate: parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

function parseFrameRate(value) {
  if (typeof value !== 'string') return null;
  const [numerator, denominator] = value.split('/').map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}
