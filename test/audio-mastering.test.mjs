import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { masterAudioFile } from '../src/timeline/audio-mastering.mjs';
import { probeMedia } from '../src/media/probe.mjs';

test('keeps silent audio valid when loudness cannot be measured', (t) => {
  const root = mkdtempSync(join(process.cwd(), '.aive-master-silence-'));
  try {
    const output = join(root, 'silent.mp4');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-shortest', output,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const result = masterAudioFile(output, 'mp4', {
      integratedLoudnessLUFS: -16,
      truePeakDBTP: -1.5,
      loudnessRangeLU: 11,
    }, 30);
    const media = probeMedia(output);

    assert.equal(result.loudnessMode, 'silent-bypass');
    assert.equal(media.hasAudio, true);
    assert.equal(media.width, 320);
    assert.equal(media.height, 180);
    assert.ok(Math.abs(media.durationSeconds - 2) < 0.1);
    assert.deepEqual(readdirSync(root), ['silent.mp4']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies equalizer bands and enforces the final sample-peak limiter', (t) => {
  const root = mkdtempSync(join(process.cwd(), '.aive-master-limiter-'));
  try {
    const output = join(root, 'limited.mp4');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=2,volume=0.05', '-t', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-shortest', output,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const result = masterAudioFile(output, 'mp4', {
      integratedLoudnessLUFS: -5,
      truePeakDBTP: 0,
      loudnessRangeLU: 11,
      equalizer: [{ frequencyHz: 1000, gainDB: 2, q: 1 }],
      limiter: { limitDBFS: -8, attackMs: 5, releaseMs: 50 },
      channelLayout: 'mono',
    }, 30);
    const levels = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-i', output, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', 'NUL',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(levels.status, 0, levels.stderr);
    const peak = Number(levels.stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
    assert.ok(Number.isFinite(peak), levels.stderr);
    assert.ok(peak <= -7, `Expected limiter output <= -7 dBFS, got ${peak} dBFS.`);
    assert.equal(result.hasAudio, true);
    assert.equal(result.audioChannels, 1);
    assert.deepEqual(readdirSync(root), ['limited.mp4']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
