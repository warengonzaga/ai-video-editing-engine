import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listFfmpegEncoders, listFfmpegFilters } from './media/ffmpeg-capabilities.mjs';
import { RHUBARB_SPRITE_CONTRACT } from './animation/rhubarb.mjs';

const require = createRequire(import.meta.url);
const VIDEO_ENCODERS = Object.freeze({
  h264: 'libx264',
  h265: 'libx265',
  vp9: 'libvpx-vp9',
  prores: 'prores_ks',
});

export function getEngineCapabilities(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Capability options must be an object.');
  for (const key of Object.keys(options)) if (!['ffmpeg', 'ffprobe', 'rhubarb'].includes(key)) throw new TypeError(`Unsupported capability option: ${key}.`);
  const ffmpegCommand = options.ffmpeg ?? 'ffmpeg';
  const ffprobeCommand = options.ffprobe ?? 'ffprobe';
  const rhubarbCommand = options.rhubarb ?? 'rhubarb';
  if (typeof ffmpegCommand !== 'string' || !ffmpegCommand.trim()) throw new TypeError('ffmpeg must be a non-empty command path.');
  if (typeof ffprobeCommand !== 'string' || !ffprobeCommand.trim()) throw new TypeError('ffprobe must be a non-empty command path.');
  if (typeof rhubarbCommand !== 'string' || !rhubarbCommand.trim()) throw new TypeError('rhubarb must be a non-empty command path.');

  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split('.')[0]);
  const ffmpeg = inspectCommand(ffmpegCommand);
  const ffprobe = inspectCommand(ffprobeCommand);
  const rhubarb = inspectCommand(rhubarbCommand, ['--version']);
  let encoders = new Set();
  let filters = new Set();
  let ffmpegInspectionError;
  if (ffmpeg.available) {
    try {
      encoders = listFfmpegEncoders(ffmpegCommand);
      filters = listFfmpegFilters(ffmpegCommand);
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
      rhubarb,
      hyperframes: { available: hyperframes },
      gsap: { available: gsap },
    },
    avatar: {
      phoneticLipSync: {
        available: rhubarb.available,
        adapter: 'rhubarb',
        requiredMouthShapes: RHUBARB_SPRITE_CONTRACT.requiredShapes,
        requiredAvatarMouthShapes: RHUBARB_SPRITE_CONTRACT.requiredAvatarShapes,
        restShape: RHUBARB_SPRITE_CONTRACT.restShape,
        optionalMouthShapes: RHUBARB_SPRITE_CONTRACT.optionalShapes,
        defaultExtendedShapes: RHUBARB_SPRITE_CONTRACT.defaultExtendedShapes,
        spriteStatesMustBeDistinct: true,
        spriteCanvasesMustMatch: true,
        spriteFilesMustHaveDistinctContent: true,
        externalCueTracks: true,
      },
    },
    render: {
      videoEncoders: Object.fromEntries(Object.entries(VIDEO_ENCODERS).map(([id, name]) => [id, encoders.has(name)])),
      filters: {
        rubberband: filters.has('rubberband'),
        afftdn: filters.has('afftdn'),
        stereotools: filters.has('stereotools'),
        equalizer: filters.has('equalizer'),
        highpass: filters.has('highpass'),
        lowpass: filters.has('lowpass'),
        acompressor: filters.has('acompressor'),
        sidechaincompress: filters.has('sidechaincompress'),
        loudnorm: filters.has('loudnorm'),
        alimiter: filters.has('alimiter'),
        aresample: filters.has('aresample'),
        reverse: filters.has('reverse'),
        areverse: filters.has('areverse'),
        colorspace: filters.has('colorspace'),
        zscale: filters.has('zscale'),
      },
    },
    requiredToolsReady: nodeMajor >= 22 && ffmpeg.available && ffprobe.available && hyperframes && gsap,
  };
}

function inspectCommand(command, args = ['-version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
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
