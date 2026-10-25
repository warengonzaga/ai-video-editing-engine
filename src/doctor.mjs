#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
if (!ready) process.exitCode = 1;

function checkCommand(label, command) {
  const result = spawnSync(command, ['-version'], {
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
