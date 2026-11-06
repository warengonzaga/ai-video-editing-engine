import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { applySidechainDuckingProxies } from '../src/timeline/sidechain-render.mjs';

test('compresses a music clip while the source track carries an audible signal', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'engine-sidechain-'));
  try {
    mkdirSync(join(root, 'assets'));
    const musicPath = join(root, 'assets', 'music.wav');
    const narrationPath = join(root, 'assets', 'narration.wav');
    const music = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-af', 'volume=2', '-c:a', 'pcm_s16le', musicPath,
    ], { encoding: 'utf8', windowsHide: true });
    if (music.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(music.status, 0, music.stderr);
    const voice = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=880:sample_rate=48000:duration=3',
      '-af', "volume=0:enable='lt(t,0.8)+gte(t,1.6)'", '-c:a', 'pcm_s16le', narrationPath,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(voice.status, 0, voice.stderr);

    const timeline = {
      schemaVersion: 1,
      project: { id: 'sidechain-sample', width: 320, height: 180, fps: 30, durationSeconds: 3 },
      assets: [
        { id: 'music-source', path: 'assets/music.wav', type: 'audio', durationSeconds: 3 },
        { id: 'voice-source', path: 'assets/narration.wav', type: 'audio', durationSeconds: 3 },
      ],
      tracks: [
        { id: 'music', kind: 'audio', order: 0, clips: [{ id: 'music-bed', assetId: 'music-source', sourceIn: 0, sourceOut: 3, timelineStart: 0, durationSeconds: 3 }] },
        { id: 'narration', kind: 'audio', order: 1, clips: [{ id: 'narration-clip', assetId: 'voice-source', sourceIn: 0, sourceOut: 3, timelineStart: 0, durationSeconds: 3 }] },
      ],
      audioMix: { ducking: [], sidechain: [{ sourceTrackId: 'narration', targetTrackId: 'music', thresholdDb: -30, ratio: 10, attackSeconds: 0.01, releaseSeconds: 0.1 }] },
    };
    const temporaryAssets = [];
    const rendered = applySidechainDuckingProxies(root, timeline, temporaryAssets);
    const musicClip = rendered.tracks[0].clips[0];
    const duckedPath = join(root, ...rendered.assets.find((asset) => asset.id === musicClip.assetId).path.split('/'));
    const samples = decodeMono(duckedPath);
    const before = rms(samples, 0.2, 0.6);
    const during = rms(samples, 1, 1.4);
    const after = rms(samples, 2, 2.4);
    assert.ok(during < before * 0.65, `Expected voice to duck music; RMS before=${before}, during=${during}`);
    assert.ok(during < after * 0.65, `Expected music to recover after voice; RMS during=${during}, after=${after}`);
    assert.equal(temporaryAssets.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function decodeMono(path) {
  const result = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-i', path,
    '-ac', '1', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
  ], { encoding: null, windowsHide: true });
  assert.equal(result.status, 0, result.stderr?.toString());
  return new Float32Array(result.stdout.buffer, result.stdout.byteOffset, Math.floor(result.stdout.byteLength / 4));
}

function rms(samples, startSeconds, endSeconds) {
  const start = Math.floor(startSeconds * 48000);
  const end = Math.min(samples.length, Math.floor(endSeconds * 48000));
  let sum = 0;
  for (let index = start; index < end; index++) sum += samples[index] ** 2;
  return Math.sqrt(sum / (end - start));
}
