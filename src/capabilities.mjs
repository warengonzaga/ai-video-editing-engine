import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listFfmpegEncoders, parseFfmpegFilters } from './media/ffmpeg-capabilities.mjs';

const require = createRequire(import.meta.url);
const VIDEO_ENCODERS = Object.freeze({
  h264: 'libx264',
  h265: 'libx265',
  vp9: 'libvpx-vp9',
  prores: 'prores_ks',
});

export function getEngineCapabilities(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Capability options must be an object.');
  for (const key of Object.keys(options)) if (!['ffmpeg', 'ffprobe'].includes(key)) throw new TypeError(`Unsupported capability option: ${key}.`);
  const ffmpegCommand = options.ffmpeg ?? 'ffmpeg';
  const ffprobeCommand = options.ffprobe ?? 'ffprobe';
  if (typeof ffmpegCommand !== 'string' || !ffmpegCommand.trim()) throw new TypeError('ffmpeg must be a non-empty command path.');
  if (typeof ffprobeCommand !== 'string' || !ffprobeCommand.trim()) throw new TypeError('ffprobe must be a non-empty command path.');

  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split('.')[0]);
  const ffmpeg = inspectCommand(ffmpegCommand);
  const ffprobe = inspectCommand(ffprobeCommand);
  let encoders = new Set();
  let filters = new Set();
  let ffmpegInspectionError;
  if (ffmpeg.available) {
    try {
      encoders = listFfmpegEncoders(ffmpegCommand);
      const output = spawnSync(ffmpegCommand, ['-hide_banner', '-filters'], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (output.error || output.status !== 0) throw new Error(output.error?.message ?? output.stderr.trim());
      filters = parseFfmpegFilters(output.stdout);
    } catch (error) {
      ffmpegInspectionError = error.message;
    }
  }

  const hyperframes = packageAvailable('hyperframes');
  const gsap = packageAvailable('gsap');
  return {
    schemaVersion: 1,
    node: { version: nodeVersion, supported: nodeMajor >= 22 },
    tools: {
      ffmpeg: { ...ffmpeg, ...(ffmpegInspectionError ? { inspectionError: ffmpegInspectionError } : {}) },
      ffprobe,
      hyperframes: { available: hyperframes },
      gsap: { available: gsap },
    },
    render: {
      videoEncoders: Object.fromEntries(Object.entries(VIDEO_ENCODERS).map(([id, name]) => [id, encoders.has(name)])),
      filters: { rubberband: filters.has('rubberband'), colorspace: filters.has('colorspace') },
    },
    requiredToolsReady: nodeMajor >= 22 && ffmpeg.available && ffprobe.available && hyperframes && gsap,
  };
}

function inspectCommand(command) {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) return { available: false };
  return { available: true, version: result.stdout.trim().split(/\r?\n/, 1)[0] };
}

function packageAvailable(name) {
  try {
    require.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}
