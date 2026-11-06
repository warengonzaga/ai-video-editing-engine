import { probeMediaAsync } from './probe.mjs';
import { listFfmpegDecoders, listFfmpegDemuxers } from './ffmpeg-capabilities.mjs';

/** Probe a media file and report whether the local FFmpeg build has its demuxer and stream decoders. */
export async function inspectMediaCompatibility(inputPath, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Media compatibility options must be an object.');
  for (const field of Object.keys(options)) if (!['ffmpeg', 'signal'].includes(field)) throw new TypeError(`Unsupported media compatibility option: ${field}.`);
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  if (typeof ffmpeg !== 'string' || !ffmpeg.trim()) throw new TypeError('ffmpeg must be a non-empty command path.');

  const media = await probeMediaAsync(inputPath, { requireVideo: false, signal: options.signal });
  const demuxers = listFfmpegDemuxers(ffmpeg);
  const decoders = listFfmpegDecoders(ffmpeg);
  const sourceFormats = typeof media.formatName === 'string'
    ? media.formatName.split(',').map((name) => name.trim()).filter(Boolean)
    : [];
  const containerAvailable = sourceFormats.some((format) => demuxers.has(format));
  const video = media.videoStreams.map((stream) => ({
    streamIndex: stream.streamIndex,
    codec: stream.codec,
    available: typeof stream.codec === 'string' && decoders.has(stream.codec),
  }));
  const audio = media.audioStreams.map((stream) => ({
    streamIndex: stream.streamIndex,
    codec: stream.codec,
    available: typeof stream.codec === 'string' && decoders.has(stream.codec),
  }));
  const unsupported = [];
  if (!containerAvailable) unsupported.push({ kind: 'container', formats: sourceFormats });
  for (const stream of [...video, ...audio]) {
    if (!stream.available) unsupported.push({ kind: 'decoder', streamIndex: stream.streamIndex, codec: stream.codec });
  }
  return {
    schemaVersion: 1,
    path: media.path,
    durationSeconds: media.durationSeconds,
    sourceFormats,
    containerAvailable,
    streams: { video, audio },
    compatible: unsupported.length === 0 && video.length + audio.length > 0,
    unsupported,
  };
}
