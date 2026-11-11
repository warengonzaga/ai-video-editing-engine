import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { frameToSeconds, secondsToFrame, snapTimeToFrame } from '../src/media/frame-time.mjs';
import { parseProbeOutput, probeMedia } from '../src/media/probe.mjs';
import { createFilterGraph, getKeepRanges, renderCuts } from '../src/media/render-cuts.mjs';

test('parses ffprobe streams and frame rate', () => {
  const result = parseProbeOutput(
    JSON.stringify({
      format: { duration: '4.0', start_time: '0.000000' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
          r_frame_rate: '30/1',
          start_time: '0.040000',
          duration: '3.96',
          time_base: '1/90000',
          color_space: 'bt709',
          color_transfer: 'bt709',
          color_primaries: 'bt709',
          color_range: 'tv',
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          channel_layout: 'stereo',
          start_time: '0.000000',
          duration: '4.0',
          time_base: '1/48000',
        },
      ],
    }),
  );
  assert.equal(result.durationSeconds, 4);
  assert.equal(result.frameRate, 30000 / 1001);
  assert.equal(result.nominalFrameRate, 30);
  assert.equal(result.hasAudio, true);
  assert.equal(result.audioChannels, 2);
  assert.equal(result.audioChannelLayout, 'stereo');
  assert.equal(result.colorSpace, 'bt709');
  assert.equal(result.colorTransfer, 'bt709');
  assert.equal(result.colorPrimaries, 'bt709');
  assert.equal(result.colorRange, 'tv');
  assert.deepEqual(result.streamTiming, {
    containerStartSeconds: 0,
    videoStartSeconds: 0.04,
    videoDurationSeconds: 3.96,
    audioStartSeconds: 0,
    audioDurationSeconds: 4,
    videoTimeBase: '1/90000',
    audioTimeBase: '1/48000',
  });
});

test('records every audio stream with its selectable ordinal and language metadata', () => {
  const result = parseProbeOutput(
    JSON.stringify({
      format: { duration: '2' },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'h264',
          width: 320,
          height: 180,
          avg_frame_rate: '30/1',
          r_frame_rate: '30/1',
          duration: '2',
        },
        {
          index: 1,
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          channel_layout: 'stereo',
          sample_rate: '48000',
          start_time: '0',
          duration: '2',
          time_base: '1/48000',
          tags: { language: 'eng', title: 'Narration' },
        },
        { index: 2, codec_type: 'subtitle', codec_name: 'mov_text' },
        {
          index: 3,
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 1,
          channel_layout: 'mono',
          sample_rate: '44100',
          start_time: '0.01',
          duration: '1.9',
          time_base: '1/44100',
          tags: { language: 'spa', title: 'Spanish' },
        },
      ],
    }),
  );
  assert.equal(result.audioStreams.length, 2);
  assert.deepEqual(
    result.audioStreams.map(({ index, streamIndex, language, title, channels }) => ({
      index,
      streamIndex,
      language,
      title,
      channels,
    })),
    [
      { index: 0, streamIndex: 1, language: 'eng', title: 'Narration', channels: 2 },
      { index: 1, streamIndex: 3, language: 'spa', title: 'Spanish', channels: 1 },
    ],
  );
  assert.equal(result.streamTiming.audioStartSeconds, 0);
  assert.equal(result.audioChannels, 2);
});

test('probes average and nominal rates for a variable-frame-rate source', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-vfr-probe-'));
  try {
    for (const [name, color, fps, duration] of [
      ['red', 'red', '30', '1'],
      ['blue', 'blue', '15', '2'],
    ]) {
      const generated = spawnSync(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=c=${color}:s=160x90:r=${fps}:d=${duration}`,
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '0',
          '-pix_fmt',
          'yuv420p',
          join(root, `${name}.mp4`),
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
      assert.equal(generated.status, 0, generated.stderr);
    }
    const list = join(root, 'concat.txt');
    writeFileSync(
      list,
      `file '${join(root, 'red.mp4').replaceAll('\\\\', '/')}'\nfile '${join(root, 'blue.mp4').replaceAll('\\\\', '/')}'\n`,
    );
    const source = join(root, 'variable-rate.mp4');
    const generated = spawnSync(
      'ffmpeg',
      ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', source],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(generated.status, 0, generated.stderr);

    const media = probeMedia(source);
    assert.equal(media.durationSeconds, 3);
    assert.equal(media.frameRate, 20);
    assert.equal(media.nominalFrameRate, 30);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('converts between rational frame positions and seconds with explicit rounding', () => {
  assert.equal(secondsToFrame(1, '30000/1001'), 30);
  assert.equal(secondsToFrame(0.5, 30, 'floor'), 15);
  assert.equal(secondsToFrame(0.501, 30, 'ceil'), 16);
  assert.ok(Math.abs(frameToSeconds(30, '30000/1001') - 1.001) < 1e-12);
  assert.equal(snapTimeToFrame(0.501, 30), 0.5);
  assert.throws(() => secondsToFrame(1, 30, 'random'), /rounding/);
  assert.throws(() => frameToSeconds(-1, 30), /non-negative/);
});

test('accepts audio-only sources when the caller does not require video', () => {
  const result = parseProbeOutput(
    JSON.stringify({
      format: { duration: '2.5' },
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    }),
    '',
    { requireVideo: false },
  );
  assert.equal(result.hasAudio, true);
  assert.equal(result.width, null);
});

test('CLI probes audio-only sources without requiring a video stream', (t) => {
  const root = mkdtempSync(join(process.cwd(), '.audio-probe-test-'));
  try {
    const audio = join(root, 'voice.wav');
    const generated = spawnSync(
      'ffmpeg',
      ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', audio],
      { encoding: 'utf8', windowsHide: true },
    );
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);
    const cli = spawnSync(process.execPath, ['src/cli.mjs', 'probe', audio], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr);
    const info = JSON.parse(cli.stdout);
    assert.equal(info.hasAudio, true);
    assert.equal(info.width, null);
    assert.ok(info.durationSeconds > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('builds ordered keep ranges and an A/V-synced filter graph', () => {
  const ranges = getKeepRanges(10, [
    { sourceStart: 2, sourceEnd: 3 },
    { sourceStart: 7, sourceEnd: 8 },
  ]);
  assert.deepEqual(ranges, [
    { start: 0, end: 2 },
    { start: 3, end: 7 },
    { start: 8, end: 10 },
  ]);
  assert.match(createFilterGraph(ranges, true), /concat=n=3:v=1:a=1\[v\]\[a\]/);
});

test('renders a real cut video and preserves its audio stream', (t) => {
  const root = mkdtempSync(join(process.cwd(), '.media-test-'));
  try {
    const source = join(root, 'source.mp4');
    const output = join(root, 'cut.mp4');
    const generated = spawnSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=25:duration=4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=4',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        '-c:a',
        'aac',
        '-shortest',
        source,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);
    const durationSeconds = probeMedia(source).durationSeconds;
    assert.throws(
      () =>
        renderCuts(
          source,
          {
            schemaVersion: 1,
            sourceDurationSeconds: durationSeconds,
            reviewStatus: 'needs-review',
            cuts: [{ sourceStart: 1, sourceEnd: 2, reason: 'unreviewed provider cut' }],
          },
          output,
        ),
      /unapproved edit suggestions/,
    );
    assert.equal(existsSync(output), false);
    const result = renderCuts(
      source,
      {
        schemaVersion: 1,
        sourceDurationSeconds: durationSeconds,
        cuts: [{ sourceStart: 1, sourceEnd: 2, reason: 'smoke test cut' }],
      },
      output,
    );
    const rendered = probeMedia(output);
    assert.equal(rendered.hasAudio, true);
    assert.ok(Math.abs(rendered.durationSeconds - result.durationSeconds) < 0.15);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
