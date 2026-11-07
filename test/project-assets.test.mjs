import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVideoProject } from '../src/project/create.mjs';
import { createAssetProxy, registerMediaAsset, resolveAssetProxies, verifyProjectAssets } from '../src/project/assets.mjs';
import { assembleEditedTimeline } from '../src/timeline/assemble.mjs';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

test('registers a copied source asset with probe and integrity metadata', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-assets-'));
  try {
    const source = join(root, 'recording.mp4');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=1',
      '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=spa', '-shortest', source,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const project = createVideoProject(root, 'asset-test', { durationSeconds: 1 });
    const asset = registerMediaAsset(project, source, { id: 'camera' });
    const manifest = JSON.parse(readFileSync(join(project, 'assets', 'manifest.json'), 'utf8'));
    assert.equal(asset.type, 'video');
    assert.equal(asset.hasAudio, true);
    assert.equal(asset.audioStreams.length, 2);
    assert.equal(asset.audioStreams[0].language, 'eng');
    assert.equal(asset.audioStreams[1].language, 'spa');
    assert.equal(asset.width, 160);
    assert.equal(asset.nominalFrameRate, asset.frameRate);
    assert.equal(asset.streamTiming.videoStartSeconds, 0);
    assert.equal(asset.streamTiming.audioStartSeconds, 0);
    assert.ok(asset.streamTiming.videoDurationSeconds > 0);
    assert.ok(asset.streamTiming.audioDurationSeconds > 0);
    assert.match(asset.streamTiming.videoTimeBase, /^1\/\d+$/);
    assert.match(asset.sha256, /^[\da-f]{64}$/);
    assert.equal(existsSync(join(project, asset.path)), true);
    assert.equal(manifest.assets[0].sha256, asset.sha256);
    assert.equal(readFileSync(source).equals(readFileSync(join(project, asset.path))), true);
    const imagePath = join(root, 'poster.png');
    const image = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=64x32:d=1', '-frames:v', '1', imagePath,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(image.status, 0, image.stderr);
    const poster = registerMediaAsset(project, imagePath, { id: 'poster' });
    assert.equal(poster.type, 'image');
    assert.equal(poster.width, 64);
    assert.equal(poster.height, 32);
    assert.equal(JSON.parse(readFileSync(join(project, 'assets', 'manifest.json'), 'utf8')).assets.length, 2);
    const assembled = assembleEditedTimeline(project, 'camera', {
      schemaVersion: 1,
      durationSeconds: 1,
      words: [{ text: 'Hello there.', start: 0.1, end: 0.7 }],
    }, { schemaVersion: 1, sourceDurationSeconds: 1, cuts: [] });
    assert.equal(assembled.timeline.project.durationSeconds, 1);
    assert.equal(assembled.timeline.assets[0].durationSeconds, asset.durationSeconds);
    assert.deepEqual(assembled.timeline.assets[0].streamTiming, asset.streamTiming);
    assert.deepEqual(assembled.timeline.assets[0].audioStreams, asset.audioStreams);
    assert.deepEqual(assembled.timeline.tracks.map(({ kind }) => kind), ['video', 'audio', 'overlay']);
    assert.equal(assembled.timeline.tracks[2].clips[0].text, 'Hello there.');
    assert.equal(assembled.timeline.tracks[2].clips[0].fontSize, 54);
    assert.equal(assembled.timeline.lineage.sourceSha256, asset.sha256);
    assert.throws(() => registerMediaAsset(project, source, { id: 'camera' }), /already registered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifies asset integrity and relinks missing media without changing its project path', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-relink-'));
  try {
    const makeVideo = (path, color) => {
      const generated = spawnSync('ffmpeg', [
        '-nostdin', '-hide_banner', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=25:d=1`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', path,
      ], { encoding: 'utf8', windowsHide: true });
      if (generated.error?.code === 'ENOENT') return false;
      assert.equal(generated.status, 0, generated.stderr);
      return true;
    };
    const original = join(root, 'original.mp4');
    const replacement = join(root, 'replacement.mp4');
    if (!makeVideo(original, 'red') || !makeVideo(replacement, 'blue')) return t.skip('FFmpeg is not installed.');

    const project = createVideoProject(root, 'relink-test', { durationSeconds: 1 });
    const asset = registerMediaAsset(project, original, { id: 'camera' });
    const timeline = {
      schemaVersion: 1,
      project: { id: 'relink-test', width: asset.width, height: asset.height, fps: asset.frameRate, durationSeconds: 1 },
      assets: [asset],
      tracks: [{ id: 'video', kind: 'video', order: 0, clips: [{ id: 'clip', assetId: 'camera', sourceIn: 0, sourceOut: 1, timelineStart: 0, durationSeconds: 1 }] }],
      lineage: { assetId: 'camera', sourceSha256: asset.sha256 },
    };
    writeFileSync(join(project, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
    const projectMediaPath = join(project, asset.path);
    writeFileSync(projectMediaPath, 'damaged asset');
    assert.equal(verifyProjectAssets(project)[0].status, 'modified');
    const modifiedReport = spawnSync(process.execPath, [cliPath, 'asset', 'verify', project], { encoding: 'utf8', windowsHide: true });
    assert.equal(modifiedReport.status, 1);
    assert.equal(JSON.parse(modifiedReport.stdout)[0].status, 'modified');
    rmSync(projectMediaPath);
    assert.equal(verifyProjectAssets(project)[0].status, 'missing');
    const missingReport = spawnSync(process.execPath, [cliPath, 'asset', 'verify', project], { encoding: 'utf8', windowsHide: true });
    assert.equal(missingReport.status, 1);
    assert.equal(JSON.parse(missingReport.stdout)[0].status, 'missing');

    const relinked = JSON.parse(execFileSync(process.execPath, [cliPath, 'asset', 'relink', project, 'camera', replacement], { encoding: 'utf8' }));
    assert.equal(relinked.id, 'camera');
    assert.equal(relinked.path, asset.path);
    assert.notEqual(relinked.sha256, asset.sha256);
    assert.equal(verifyProjectAssets(project)[0].status, 'ok');
    assert.equal(JSON.parse(readFileSync(join(project, 'assets', 'manifest.json'), 'utf8')).assets[0].sha256, relinked.sha256);
    const updatedTimeline = JSON.parse(readFileSync(join(project, 'timeline.json'), 'utf8'));
    assert.equal(updatedTimeline.assets[0].sha256, relinked.sha256);
    assert.equal(updatedTimeline.assets[0].path, asset.path);
    assert.equal(updatedTimeline.lineage.sourceSha256, relinked.sha256);
    assert.equal(readFileSync(projectMediaPath).equals(readFileSync(replacement)), true);
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cliPath, 'asset', 'verify', project], { encoding: 'utf8' })).map(({ id, status }) => ({ id, status })), [{ id: 'camera', status: 'ok' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates reusable bounded video proxies without changing source media', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-proxy-'));
  try {
    const source = join(root, 'source.mp4');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', source,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const project = createVideoProject(root, 'proxy-test', { width: 320, height: 180, durationSeconds: 2 });
    const asset = registerMediaAsset(project, source, { id: 'camera' });
    const sourceBytes = readFileSync(source);
    const proxy = JSON.parse(execFileSync(process.execPath, [cliPath, 'asset', 'proxy', 'create', project, 'camera', '320', '30', '30'], { encoding: 'utf8' }));
    assert.equal(proxy.width, 320);
    assert.equal(proxy.height, 180);
    assert.ok(proxy.sizeBytes < asset.sizeBytes);
    assert.match(proxy.sha256, /^[\da-f]{64}$/);
    assert.equal(proxy.sourceSha256, asset.sha256);
    assert.equal(proxy.targetFrameRate, '30');
    assert.equal(proxy.nominalFrameRate, 30);
    assert.equal(existsSync(join(project, ...proxy.path.split('/'))), true);
    assert.equal(readFileSync(source).equals(sourceBytes), true);
    assert.deepEqual(createAssetProxy(project, 'camera', { maxDimension: 320, crf: 30, frameRate: 30 }), proxy);
    assert.deepEqual(verifyProjectAssets(project).map(({ variant, status }) => ({ variant, status })), [
      { variant: 'source', status: 'ok' },
      { variant: 'proxy', status: 'ok' },
    ]);
    writeFileSync(join(project, ...proxy.path.split('/')), 'damaged proxy');
    assert.equal(verifyProjectAssets(project)[1].status, 'modified');
    assert.deepEqual(createAssetProxy(project, 'camera', { maxDimension: 320, crf: 30, frameRate: 30 }), proxy);
    assert.equal(verifyProjectAssets(project)[1].status, 'ok');
    assert.throws(() => createAssetProxy(project, 'camera', { maxDimension: 100 }), /maxDimension/);
    const replacement = join(root, 'replacement.mp4');
    const replacementResult = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=25:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', replacement,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(replacementResult.status, 0, replacementResult.stderr);
    const replacementBytes = readFileSync(replacement);
    execFileSync(process.execPath, [cliPath, 'asset', 'relink', project, 'camera', replacement], { encoding: 'utf8' });
    assert.equal(existsSync(join(project, ...proxy.path.split('/'))), false);
    assert.deepEqual(verifyProjectAssets(project).map(({ variant, status }) => ({ variant, status })), [
      { variant: 'source', status: 'ok' },
    ]);
    assert.equal(readFileSync(replacement).equals(replacementBytes), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normalizes VFR draft proxies to the requested project frame rate', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-vfr-proxy-'));
  try {
    const source = join(root, 'source-vfr.mp4');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=24:duration=2',
      '-vf', 'select=not(eq(mod(n\\,5)\\,3))', '-fps_mode', 'vfr',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', source,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const project = createVideoProject(root, 'vfr-proxy-test', { width: 320, height: 180, fps: 24, durationSeconds: 2 });
    const asset = registerMediaAsset(project, source, { id: 'camera' });
    assert.ok(asset.frameRate < asset.nominalFrameRate);
    const proxy = createAssetProxy(project, 'camera', { maxDimension: 320, frameRate: 24 });
    const legacyProxy = createAssetProxy(project, 'camera', { maxDimension: 320, crf: 40 });
    assert.equal(proxy.targetFrameRate, '24');
    assert.equal(proxy.frameRate, 24);
    assert.equal(proxy.nominalFrameRate, 24);
    assert.equal(legacyProxy.targetFrameRate, undefined);
    const timeline = {
      project: { id: 'vfr-proxy-test', fps: 24 },
      assets: [asset],
      tracks: [{ kind: 'video', clips: [{ assetId: 'camera' }] }],
    };
    assert.equal(resolveAssetProxies(project, timeline).get('camera').path, proxy.path);
    assert.equal(readFileSync(source).equals(readFileSync(join(project, asset.path))), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
