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
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio').map((stream, index) => ({
    index,
    streamIndex: Number.isSafeInteger(stream.index) ? stream.index : index,
    codec: stream.codec_name ?? null,
    channels: Number(stream.channels) || null,
    channelLayout: stream.channel_layout ?? null,
    sampleRate: Number(stream.sample_rate) || null,
    startSeconds: parseOptionalNumber(stream.start_time),
    durationSeconds: parseOptionalNumber(stream.duration),
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
    width: Number(video?.width) || null,
    height: Number(video?.height) || null,
    frameRate: parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate),
    nominalFrameRate: parseFrameRate(video?.r_frame_rate),
    hasAudio: Boolean(audio),
    audioChannels: audio?.channels ?? null,
    audioChannelLayout: audio?.channelLayout ?? null,
    audioStreams,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec ?? null,
    colorSpace: video?.color_space ?? null,
    colorTransfer: video?.color_transfer ?? null,
    colorPrimaries: video?.color_primaries ?? null,
    colorRange: video?.color_range ?? null,
    streamTiming: {
      containerStartSeconds: parseOptionalNumber(info.format?.start_time),
      videoStartSeconds: parseOptionalNumber(video?.start_time),
      videoDurationSeconds: parseOptionalNumber(video?.duration),
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

function parseFrameRate(value) {
  if (typeof value !== 'string') return null;
  const [numerator, denominator] = value.split('/').map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}
