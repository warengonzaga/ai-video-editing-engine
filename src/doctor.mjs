#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listFfmpegEncoders, listFfmpegFilters } from './media/ffmpeg-capabilities.mjs';
import { doctorHyperframes } from './render/hyperframes.mjs';

const nodeVersion = process.versions.node.split('.').map(Number);
const require = createRequire(import.meta.url);
const results = [
  {
    name: 'Node.js',
    ok: nodeVersion[0] >= 22,
    detail: `found ${process.versions.node}; requires 22 or newer`,
  },
  checkCommand('FFmpeg', 'ffmpeg'),
  checkCommand('ffprobe', 'ffprobe'),
  checkPackage('HyperFrames', 'hyperframes'),
  checkPackage('GSAP', 'gsap'),
];

for (const result of results) {
  console.log(`${result.ok ? '✓' : '✗'} ${result.name}: ${result.detail}`);
  if (!result.ok && result.name !== 'Node.js') {
    if (result.name === 'FFmpeg' || result.name === 'ffprobe') {
      console.log('  Install FFmpeg with ffprobe and make both commands available on PATH.');
      console.log('  Guide: https://ffmpeg.org/download.html');
    } else if (result.name === 'HyperFrames' || result.name === 'GSAP') {
      console.log('  Run npm install in the engine repository.');
    }
  } else if (!result.ok && result.name === 'Node.js') {
    console.log('  Install Node.js 22 or newer: https://nodejs.org/en/download');
  }
}

const ready = results.every((result) => result.ok);
const rhubarb = checkCommand('Rhubarb Lip Sync', 'rhubarb', ['--version']);
console.log(`${rhubarb.ok ? '✓' : '⚠'} Optional ${rhubarb.name}: ${rhubarb.detail}`);
if (!rhubarb.ok) {
  console.log('  Install the optional CLI and make `rhubarb` available on PATH to enable phonetic mouth cues.');
  console.log('  Project: https://github.com/DanielSWolf/rhubarb-lip-sync/releases');
}
if (results.find((result) => result.name === 'HyperFrames')?.ok) {
  console.log('\nChecking HyperFrames renderer requirements:');
  try {
    doctorHyperframes(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
console.log(ready ? 'Required engine tools are ready.' : 'Some required engine tools are missing.');
try {
  const filters = listFfmpegFilters();
  for (const [filter, requirement] of [
    ['rubberband', 'pitch-preserving audio speed ramps'],
    ['equalizer', 'audio equalization and mastering bands'],
    ['highpass', 'audio high-pass filtering'],
    ['lowpass', 'audio low-pass filtering'],
    ['acompressor', 'audio compression effects'],
    ['afftdn', 'per-clip spectral denoise'],
    ['stereotools', 'per-clip stereo balance'],
    ['sidechaincompress', 'signal-aware sidechain compression'],
    ['loudnorm', 'audio loudness mastering'],
    ['alimiter', 'audio peak limiting'],
    ['aresample', 'mastered output channel mapping'],
    ['reverse', 'video reverse playback'],
    ['areverse', 'audio reverse playback'],
    ['colorspace', 'Rec.709 and Rec.2020 SDR output profiles'],
    ['zscale', 'HDR10 output'],
  ]) {
    const available = filters.has(filter);
    console.log(`${available ? '✓' : '⚠'} FFmpeg ${filter} filter: ${available ? 'available' : `not available; required for ${requirement}`}`);
  }
} catch (error) {
  console.log(`⚠ FFmpeg filters: could not verify (${error.message})`);
}
if (results.find((result) => result.name === 'FFmpeg')?.ok) {
  try {
    const encoders = listFfmpegEncoders();
    for (const [name, encoder] of [['H.264', 'libx264'], ['H.265', 'libx265'], ['VP9', 'libvpx-vp9'], ['ProRes', 'prores_ks']]) {
      const available = encoders.has(encoder);
      console.log(`${available ? '✓' : '⚠'} FFmpeg ${name} encoder: ${available ? 'available' : `not available (${encoder})`}`);
    }
  } catch (error) {
    console.log(`⚠ FFmpeg encoders: could not verify (${error.message})`);
  }
}
if (!ready) process.exitCode = 1;

function checkCommand(label, command, args = ['-version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { name: label, ok: false, detail: 'not found or failed to run' };
  }
  const firstLine = result.stdout.trim().split(/\r?\n/, 1)[0];
  return { name: label, ok: true, detail: firstLine };
}

function checkPackage(label, packageName) {
  try {
    require.resolve(`${packageName}/package.json`);
    return { name: label, ok: true, detail: 'installed' };
  } catch {
    return { name: label, ok: false, detail: 'not installed' };
  }
}
