import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createFilterGraph, getKeepRanges, renderCuts } from '../src/media/render-cuts.mjs';
import { parseProbeOutput, probeMedia } from '../src/media/probe.mjs';

test('parses ffprobe streams and frame rate', () => {
  const result = parseProbeOutput(JSON.stringify({
    format: { duration: '4.0' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  }));
  assert.equal(result.durationSeconds, 4);
  assert.equal(result.frameRate, 30000 / 1001);
  assert.equal(result.hasAudio, true);
});

test('accepts audio-only sources when the caller does not require video', () => {
  const result = parseProbeOutput(JSON.stringify({
    format: { duration: '2.5' },
    streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
  }), '', { requireVideo: false });
  assert.equal(result.hasAudio, true);
  assert.equal(result.width, null);
});

test('builds ordered keep ranges and an A/V-synced filter graph', () => {
  const ranges = getKeepRanges(10, [
    { sourceStart: 2, sourceEnd: 3 },
    { sourceStart: 7, sourceEnd: 8 },
  ]);
  assert.deepEqual(ranges, [{ start: 0, end: 2 }, { start: 3, end: 7 }, { start: 8, end: 10 }]);
  assert.match(createFilterGraph(ranges, true), /concat=n=3:v=1:a=1\[v\]\[a\]/);
});

test('renders a real cut video and preserves its audio stream', (t) => {
  const root = mkdtempSync(join(process.cwd(), '.media-test-'));
  try {
    const source = join(root, 'source.mp4');
    const output = join(root, 'cut.mp4');
    const generated = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-shortest', source,
    ], { encoding: 'utf8', windowsHide: true });
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);
    const durationSeconds = probeMedia(source).durationSeconds;
    const result = renderCuts(source, {
      schemaVersion: 1,
      sourceDurationSeconds: durationSeconds,
      cuts: [{ sourceStart: 1, sourceEnd: 2, reason: 'smoke test cut' }],
    }, output);
    const rendered = probeMedia(output);
    assert.equal(rendered.hasAudio, true);
    assert.ok(Math.abs(rendered.durationSeconds - result.durationSeconds) < 0.15);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
