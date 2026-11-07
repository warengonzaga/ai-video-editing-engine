import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listFfmpegDecoders, listFfmpegDemuxers, listFfmpegEncoders, listFfmpegFilters } from './media/ffmpeg-capabilities.mjs';
import { RHUBARB_SPRITE_CONTRACT } from './animation/rhubarb.mjs';
import { CANVAS_PRESETS } from './project/presets.mjs';

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
  let decoders = new Set();
  let demuxers = new Set();
  let filters = new Set();
  let ffmpegInspectionError;
  let inputInspectionError;
  if (ffmpeg.available) {
    try {
      encoders = listFfmpegEncoders(ffmpegCommand);
      filters = listFfmpegFilters(ffmpegCommand);
    } catch (error) {
      ffmpegInspectionError = error.message;
    }
    try {
      decoders = listFfmpegDecoders(ffmpegCommand);
      demuxers = listFfmpegDemuxers(ffmpegCommand);
    } catch (error) {
      inputInspectionError = error.message;
    }
  }

  const hyperframes = packageAvailable('hyperframes');
  const gsap = packageAvailable('gsap');
  const renderRuntimeAvailable = nodeMajor >= 22 && ffmpeg.available && ffprobe.available && hyperframes && gsap;
  const supportsFilter = (name) => filters.has(name);
  const supportsEncoder = (name) => encoders.has(name);
  const colorProfiles = {
    rec709: { available: supportsFilter('colorspace'), formats: ['mp4', 'mov', 'webm'] },
    'rec2020-sdr': { available: supportsFilter('colorspace'), formats: ['mp4', 'mov', 'webm'] },
    hdr10: { available: supportsFilter('zscale') && supportsEncoder('libx265'), formats: ['mp4', 'mov'] },
  };
  const codecsByFormat = {
    mp4: { h264: supportsEncoder('libx264'), h265: supportsEncoder('libx265') },
    mov: { h264: supportsEncoder('libx264'), h265: supportsEncoder('libx265'), prores: supportsEncoder('prores_ks') },
    webm: { vp9: supportsEncoder('libvpx-vp9') },
  };
  const outputColorProfiles = (format) => Object.fromEntries(Object.entries(colorProfiles)
    .filter(([, profile]) => profile.formats.includes(format))
    .map(([id, profile]) => {
      const compatibleEncoderAvailable = id === 'hdr10'
        ? codecsByFormat[format]?.h265 === true
        : Object.values(codecsByFormat[format] ?? {}).some(Boolean);
      return [id, profile.available && compatibleEncoderAvailable];
    }));
  const inputContainers = {
    mp4: ['mp4'],
    mov: ['mov'],
    avi: ['avi'],
    matroska: ['matroska'],
    webm: ['webm'],
    mpegts: ['mpegts'],
    mpeg: ['mpeg'],
    mp3: ['mp3'],
    ogg: ['ogg'],
    wav: ['wav'],
    image2: ['image2'],
  };
  return {
    schemaVersion: 1,
    node: { version: nodeVersion, supported: nodeMajor >= 22 },
    tools: {
      ffmpeg: { ...ffmpeg, ...(ffmpegInspectionError ? { inspectionError: ffmpegInspectionError } : {}) },
      ffprobe,
      rhubarb,
      hyperframes: { available: hyperframes },
      gsap: { available: gsap },
      browserRuntime: { available: null, checked: false, checkCommand: 'npm run doctor' },
    },
    media: {
      assetIngest: {
        available: ffmpeg.available && ffprobe.available,
        progressCallbacks: {
          supported: true,
          asyncApiOnly: true,
          stages: ['asset-copy', 'asset-probe', 'asset-publish', 'asset-relink-copy', 'asset-relink-probe', 'asset-relink-publish'],
          eventFields: ['stage', 'phase'],
          optionalEventFields: ['percent', 'completed', 'total', 'assetId'],
        },
      },
      input: {
        available: ffmpeg.available && ffprobe.available,
        inventoryChecked: ffmpeg.available && ffprobe.available && !inputInspectionError,
        ...(inputInspectionError ? { inspectionError: inputInspectionError } : {}),
        containers: Object.fromEntries(Object.entries(inputContainers)
          .map(([name, aliases]) => [name, aliases.some((alias) => demuxers.has(alias))])),
        videoDecoders: Object.fromEntries(['h264', 'hevc', 'av1', 'vp8', 'vp9', 'prores', 'mpeg2video', 'mpeg4']
          .map((name) => [name, decoders.has(name)])),
        audioDecoders: Object.fromEntries(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le']
          .map((name) => [name, decoders.has(name)])),
      },
      proxyGeneration: {
        available: ffmpeg.available && ffprobe.available,
        progressCallbacks: {
          supported: true,
          asyncApiOnly: true,
          stages: ['proxy-preflight', 'proxy-generation', 'proxy-validation', 'proxy-publish'],
          eventFields: ['stage', 'phase'],
          optionalEventFields: ['percent', 'completed', 'total', 'assetId', 'reason'],
        },
      },
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
        mouthTransition: RHUBARB_SPRITE_CONTRACT.mouthTransition,
        mouthShapeGuidance: RHUBARB_SPRITE_CONTRACT.mouthShapeGuidance,
        mouthArtworkGuidance: RHUBARB_SPRITE_CONTRACT.mouthArtworkGuidance,
        animationArtworkGuidance: RHUBARB_SPRITE_CONTRACT.animationArtworkGuidance,
        mouthVisualReviewRequired: true,
        mouthVisualReviewChecklist: RHUBARB_SPRITE_CONTRACT.mouthVisualReviewChecklist,
        spriteStatesMustBeDistinct: true,
        spriteCanvasesMustMatch: true,
        spriteFilesMustHaveDistinctContent: true,
        externalCueTracks: true,
      },
    },
    render: {
      requirementsAvailable: renderRuntimeAvailable,
      progressCallbacks: {
        supported: true,
        asyncApiOnly: true,
        stages: ['preprocessing', 'proxy-resolution', 'audio-alignment', 'playback-processing', 'audio-effects', 'sidechain-processing', 'capture', 'encoding', 'validation', 'publish', 'timeline-validation', 'mastering', 'mastering-analysis', 'mastering-encode', 'mastering-validation', 'mastering-publish'],
        eventFields: ['stage', 'phase'],
        optionalEventFields: ['percent', 'completed', 'total', 'target', 'codec', 'reason'],
      },
      videoEncoders: Object.fromEntries(Object.entries(VIDEO_ENCODERS).map(([id, name]) => [id, encoders.has(name)])),
      outputs: {
        mp4: {
          available: renderRuntimeAvailable && Object.values(codecsByFormat.mp4).some(Boolean),
          codecs: codecsByFormat.mp4,
          defaultCodec: 'h264',
          defaultCodecAvailable: codecsByFormat.mp4.h264,
          colorProfiles: outputColorProfiles('mp4'),
        },
        mov: {
          available: renderRuntimeAvailable && Object.values(codecsByFormat.mov).some(Boolean),
          codecs: codecsByFormat.mov,
          defaultCodec: 'h264',
          defaultCodecAvailable: codecsByFormat.mov.h264,
          colorProfiles: outputColorProfiles('mov'),
        },
        webm: {
          available: renderRuntimeAvailable && Object.values(codecsByFormat.webm).some(Boolean),
          codecs: codecsByFormat.webm,
          defaultCodec: 'vp9',
          defaultCodecAvailable: codecsByFormat.webm.vp9,
          colorProfiles: outputColorProfiles('webm'),
        },
        gif: { available: renderRuntimeAvailable && supportsEncoder('gif') },
        'png-sequence': { available: hyperframes },
      },
      colorProfiles,
      canvasPresets: CANVAS_PRESETS.map(({ id, aspectRatio, width, height, platforms }) => ({
        id, aspectRatio, width, height, platforms: [...platforms],
      })),
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
