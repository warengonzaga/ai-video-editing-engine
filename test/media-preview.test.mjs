import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVideoProject, generateAssetPreview, registerMediaAsset } from '../src/index.mjs';

const root = mkdtempSync(join(tmpdir(), 'aive-preview-test-'));
const projectPath = createVideoProject(root, 'preview-test', { width: 160, height: 90, fps: 24, durationSeconds: 2 });
const sourcePath = join(root, 'source.mp4');
const generated = spawnSync('ffmpeg', [
  '-nostdin', '-hide_banner', '-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=blue:size=160x90:rate=24:duration=2',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
if (generated.error || generated.status !== 0) throw new Error(`Could not generate preview fixture: ${generated.error?.message ?? generated.stderr}`);
const asset = registerMediaAsset(projectPath, sourcePath, { id: 'preview-source' });

test('creates source-verified thumbnails and waveform previews with a validated reusable cache', async () => {
  try {
    const preview = await generateAssetPreview(projectPath, asset.id, { thumbnailIntervalSeconds: 1, waveformPoints: 128 });
    assert.equal(preview.schemaVersion, 1);
    assert.equal(preview.assetId, asset.id);
    assert.equal(preview.thumbnails.length, 2);
    assert.deepEqual(preview.thumbnails.map(({ timeSeconds }) => timeSeconds), [0, 1]);
    assert.ok(preview.thumbnails.every(({ path }) => existsSync(join(projectPath, ...path.split('/')))));
    assert.equal(preview.waveform.sampleRate, 4000);
    assert.equal(preview.waveform.points.length, 128);
    assert.ok(preview.waveform.points.some(({ min, max }) => min < -0.05 && max > 0.05));

    const cached = await generateAssetPreview(projectPath, asset.id, { thumbnailIntervalSeconds: 1, waveformPoints: 128 });
    assert.deepEqual(cached, preview);
    assert.ok(existsSync(join(projectPath, ...cached.waveform.path.split('/'))));

    const alternatePreview = await generateAssetPreview(projectPath, asset.id, { thumbnailIntervalSeconds: 1, waveformPoints: 64 });
    const waveformPath = join(projectPath, ...alternatePreview.waveform.path.split('/'));
    appendFileSync(waveformPath, 'tampered');
    await assert.rejects(generateAssetPreview(projectPath, asset.id, { thumbnailIntervalSeconds: 1, waveformPoints: 64 }), /missing or modified/);
    await assert.rejects(generateAssetPreview(projectPath, asset.id, { waveformPoints: 1 }), /waveformPoints/);
    await assert.rejects(generateAssetPreview(projectPath, asset.id, { thumbnailIntervalSeconds: 0.1 }), /thumbnailIntervalSeconds/);
    appendFileSync(join(projectPath, 'assets', asset.path.split('/').at(-1)), 'tampered');
    await assert.rejects(generateAssetPreview(projectPath, asset.id), /failed integrity verification/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('supports audio-only and still-image preview assets', async () => {
  const otherRoot = mkdtempSync(join(tmpdir(), 'aive-preview-modes-test-'));
  try {
    const otherProject = createVideoProject(otherRoot, 'preview-modes', { width: 160, height: 90, fps: 24, durationSeconds: 2 });
    const audioPath = join(otherRoot, 'audio.wav');
    const imagePath = join(otherRoot, 'still.png');
    const audioResult = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1',
      '-c:a', 'pcm_s16le', audioPath,
    ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    const imageResult = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:size=100x80',
      '-frames:v', '1', '-update', '1', imagePath,
    ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    if (audioResult.error || audioResult.status !== 0 || imageResult.error || imageResult.status !== 0) {
      throw new Error(`Could not generate preview fixtures: ${audioResult.stderr} ${imageResult.stderr}`);
    }
    const audioAsset = registerMediaAsset(otherProject, audioPath, { id: 'audio-source' });
    const imageAsset = registerMediaAsset(otherProject, imagePath, { id: 'image-source' });
    const audioPreview = await generateAssetPreview(otherProject, audioAsset.id, { waveformPoints: 64 });
    const imagePreview = await generateAssetPreview(otherProject, imageAsset.id);
    assert.equal(audioPreview.thumbnails.length, 0);
    assert.equal(audioPreview.waveform.points.length, 64);
    assert.equal(imagePreview.thumbnails.length, 1);
    assert.equal(imagePreview.thumbnails[0].timeSeconds, 0);
    assert.equal(imagePreview.waveform, undefined);

    const optionsPath = join(otherRoot, 'preview-options.json');
    writeFileSync(optionsPath, JSON.stringify({ waveformPoints: 64 }));
    const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
    const cli = spawnSync(process.execPath, [cliPath, 'asset', 'preview', otherProject, audioAsset.id, optionsPath], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).waveform.points.length, 64);
  } finally {
    rmSync(otherRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
