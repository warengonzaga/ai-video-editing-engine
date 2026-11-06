import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { runProcess } from '../render/process.mjs';

export function probeMedia(inputPath, { requireVideo = true, timeoutMs } = {}) {
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
    throw new TypeError('ffprobe timeoutMs must be a positive safe integer.');
  }
  const path = resolve(inputPath);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Media file not found: ${path}`);
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path,
  ], { encoding: 'utf8', windowsHide: true, ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}) });
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return parseProbeOutput(result.stdout, path, { requireVideo });
}

export async function probeMediaAsync(inputPath, { requireVideo = true, signal } = {}) {
  validateAbortSignal(signal);
  const path = resolve(inputPath);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Media file not found: ${path}`);
  const result = await runProcess('ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path,
  ], { signal, stdio: 'capture' });
  return parseProbeOutput(result.stdout, path, { requireVideo });
}

function validateAbortSignal(signal) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('ffprobe signal must be an AbortSignal.');
  }
}

export function parseProbeOutput(output, path = '', { requireVideo = true } = {}) {
  let info;
  try {
    info = JSON.parse(output);
  } catch (error) {
    throw new TypeError(`Invalid ffprobe JSON: ${error.message}`);
  }
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const formatDuration = parseOptionalNumber(info.format?.duration);
  const streamDuration = streams.reduce((duration, stream) =>
    Math.max(duration, parseStreamDuration(stream)), 0);
  const durationSeconds = Number.isFinite(formatDuration) && formatDuration > 0
    ? formatDuration
    : streamDuration;
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video').map((stream) => ({
    index: Number.isSafeInteger(stream.index) ? stream.index : null,
    codec: stream.codec_name ?? null,
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
    pixelFormat: stream.pix_fmt ?? null,
    frameRate: parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate),
    timeBase: stream.time_base ?? null,
    startSeconds: parseOptionalNumber(stream.start_time),
    durationSeconds: parseStreamDuration(stream) || null,
  }));
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio').map((stream, index) => ({
    index,
    streamIndex: Number.isSafeInteger(stream.index) ? stream.index : index,
    codec: stream.codec_name ?? null,
    channels: Number(stream.channels) || null,
    channelLayout: stream.channel_layout ?? null,
    sampleRate: Number(stream.sample_rate) || null,
    startSeconds: parseOptionalNumber(stream.start_time),
    durationSeconds: parseStreamDuration(stream) || null,
    timeBase: stream.time_base ?? null,
    language: typeof stream.tags?.language === 'string' ? stream.tags.language : null,
    title: typeof stream.tags?.title === 'string' ? stream.tags.title : null,
  }));
  const audio = audioStreams[0];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('Media must have a finite positive duration.');
  }
  if (requireVideo && !video) throw new TypeError('Media must contain a video stream.');
  if (!video && !audio) throw new TypeError('Media must contain a video or audio stream.');
  return {
    path,
    durationSeconds,
    formatName: typeof info.format?.format_name === 'string' ? info.format.format_name : null,
    videoStreams,
    width: Number(video?.width) || null,
    height: Number(video?.height) || null,
    frameRate: parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate),
    nominalFrameRate: parseFrameRate(video?.r_frame_rate),
    hasAudio: Boolean(audio),
    audioChannels: audio?.channels ?? null,
    audioChannelLayout: audio?.channelLayout ?? null,
    audioStreams,
    videoCodec: video?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    audioCodec: audio?.codec ?? null,
    colorSpace: video?.color_space ?? null,
    colorTransfer: video?.color_transfer ?? null,
    colorPrimaries: video?.color_primaries ?? null,
    colorRange: video?.color_range ?? null,
    streamTiming: {
      containerStartSeconds: parseOptionalNumber(info.format?.start_time),
      videoStartSeconds: parseOptionalNumber(video?.start_time),
      videoDurationSeconds: parseStreamDuration(video) || null,
      audioStartSeconds: audio?.startSeconds ?? null,
      audioDurationSeconds: audio?.durationSeconds ?? null,
      videoTimeBase: video?.time_base ?? null,
      audioTimeBase: audio?.timeBase ?? null,
    },
  };
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === 'N/A') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStreamDuration(stream) {
  if (!stream || typeof stream !== 'object') return 0;
  const duration = parseOptionalNumber(stream.duration);
  if (duration !== null && duration > 0) return duration;
  const ticks = parseOptionalNumber(stream.duration_ts);
  const [numerator, denominator] = typeof stream.time_base === 'string'
    ? stream.time_base.split('/').map(Number)
    : [];
  if (!Number.isFinite(ticks) || ticks <= 0 || !Number.isFinite(numerator)
      || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return 0;
  return ticks * numerator / denominator;
}

function parseFrameRate(value) {
  if (typeof value !== 'string') return null;
  const [numerator, denominator] = value.split('/').map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}
