import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { probeMedia } from '../src/media/probe.mjs';
import { alignOffsetAudioAssets } from '../src/timeline/render.mjs';

test('normalizes a standalone MP3 stream start before timeline playback', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'engine-audio-offset-'));
  try {
    const assetsPath = join(root, 'assets');
    mkdirSync(assetsPath);
    const sourcePath = join(assetsPath, 'voice.mp3');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'libmp3lame', '-q:a', '3', sourcePath,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);
    const probe = probeMedia(sourcePath, { requireVideo: false });
    if (probe.streamTiming.audioStartSeconds <= 0.001) return t.skip('The local MP3 encoder produced no measurable stream offset.');
    const timeline = {
      schemaVersion: 1,
      project: { id: 'audio-offset', width: 320, height: 180, fps: 30, durationSeconds: probe.durationSeconds },
      assets: [{ id: 'voice', path: 'assets/voice.mp3', type: 'audio', hasAudio: true, durationSeconds: probe.durationSeconds, streamTiming: probe.streamTiming }],
      tracks: [{ id: 'narration', kind: 'audio', order: 0, clips: [
        { id: 'voice-clip', assetId: 'voice', sourceIn: 0, sourceOut: probe.durationSeconds, timelineStart: 0, durationSeconds: probe.durationSeconds },
      ] }],
    };
    const temporaryAssets = [];
    const aligned = alignOffsetAudioAssets(root, timeline, temporaryAssets);
    const clip = aligned.tracks[0].clips[0];
    const proxy = aligned.assets.find((asset) => asset.id === clip.assetId);
    assert.notEqual(clip.assetId, 'voice');
    assert.equal(proxy.type, 'audio');
    assert.equal(temporaryAssets.length, 1);
    const normalized = probeMedia(join(root, ...proxy.path.split('/')), { requireVideo: false });
    assert.ok(Math.abs(normalized.streamTiming.audioStartSeconds) < 0.001, `Expected zero-based audio PTS, got ${normalized.streamTiming.audioStartSeconds}`);
    assert.ok(Math.abs(normalized.durationSeconds - probe.durationSeconds) < 0.02);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
