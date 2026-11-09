import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAcousticSilence, parseSilenceIntervals } from '../src/edits/detect-silence.mjs';

test('parses silence intervals including a trailing silence', () => {
  assert.deepEqual(parseSilenceIntervals('silence_start: 0.5\nsilence_end: 1.25\nsilence_start: 2.5', 3), [
    { start: 0.5, end: 1.25 },
    { start: 2.5, end: 3 },
  ]);
});

test('detects acoustic silence from real audio and keeps safety padding', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-silence-'));
  try {
    const input = join(root, 'pauses.wav');
    const result = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.6',
      '-f', 'lavfi', '-i', 'anullsrc=sample_rate=48000:channel_layout=mono:duration=0.8',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.6',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]', '-map', '[out]', input,
    ], { encoding: 'utf8', windowsHide: true });
    if (result.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(result.status, 0, result.stderr);
    const edl = detectAcousticSilence(input, { minSilenceSeconds: 0.3, paddingSeconds: 0.1 });
    assert.equal(edl.cuts.length, 1);
    assert.ok(edl.cuts[0].sourceStart >= 0.65);
    assert.ok(edl.cuts[0].sourceEnd <= 1.35);
    assert.ok(edl.cuts[0].sourceEnd > edl.cuts[0].sourceStart);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
