import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectAcousticSilence } from '../src/edits/detect-silence.mjs';
import { retimeTranscript } from '../src/edits/retime-transcript.mjs';
import { probeMedia } from '../src/media/probe.mjs';
import { createFilterGraph, renderCuts } from '../src/media/render-cuts.mjs';

const ranges = [
  { start: 0, end: 0.4 },
  { start: 0.6, end: 1 },
];

test('builds an audio-only filter graph and clamps each join fade to half a segment', () => {
  const plain = createFilterGraph(ranges, true, { audioOnly: true });
  assert.match(plain, /concat=n=2:v=0:a=1\[a\]/);
  assert.doesNotMatch(plain, /\[0:v\]|afade/);
  assert.equal(plain, createFilterGraph(ranges, true, { audioOnly: true, joinFadeSeconds: 0 }));

  const faded = createFilterGraph(ranges, true, { audioOnly: true, joinFadeSeconds: 0.012 });
  assert.match(faded, /afade=t=in:d=0\.012,afade=t=out:st=0\.388:d=0\.012/);
  assert.match(faded, /concat=n=2:v=0:a=1\[a\]/);

  const video = createFilterGraph(ranges, true, { joinFadeSeconds: 0.012 });
  assert.match(video, /\[0:v\]trim=start=0:end=0\.4/);
  assert.match(video, /afade=t=in:d=0\.012/);
  assert.match(video, /concat=n=2:v=1:a=1\[v\]\[a\]/);
  assert.doesNotMatch(createFilterGraph(ranges, false, { joinFadeSeconds: 0.012 }), /afade/);

  const clamped = createFilterGraph([{ start: 0, end: 0.01 }], true, {
    audioOnly: true,
    joinFadeSeconds: 0.012,
  });
  assert.match(clamped, /afade=t=in:d=0\.005,afade=t=out:st=0\.005:d=0\.005/);
  assert.throws(() => createFilterGraph(ranges, true, { joinFadeSeconds: -1 }), /joinFadeSeconds/);
  assert.throws(() => createFilterGraph(ranges, false, { audioOnly: true }), /requires audio/);
});

test('rejects unsupported cut outputs and invalid join fades before rendering', () => {
  const input = join(tmpdir(), 'aivee-cut-input.wav');
  const output = join(tmpdir(), 'aivee-cut-output.wav');
  assert.throws(() => renderCuts(input, {}, join(tmpdir(), 'aivee-cut-output.mp3')), /\.mp4, \.m4a, or \.wav/);
  assert.throws(() => renderCuts(input, {}, output, { joinFadeMs: -1 }), /joinFadeMs/);
  assert.throws(() => renderCuts(input, {}, output, { joinFadeMs: Number.POSITIVE_INFINITY }), /joinFadeMs/);
  assert.throws(() => renderCuts(input, {}, join(tmpdir(), 'aivee-cut-output.m4a'), null), /options must be an object/);
});

test('trims audio-only sources to wav and m4a and fades the join', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-audio-cuts-'));
  try {
    const source = join(root, 'tone.wav');
    const generated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.8:sample_rate=48000:duration=1',
      '-c:a',
      'pcm_s16le',
      source,
    ]);
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const durationSeconds = probeMedia(source, { requireVideo: false }).durationSeconds;
    const edl = {
      schemaVersion: 1,
      sourceDurationSeconds: durationSeconds,
      cuts: [{ sourceStart: 0.4, sourceEnd: 0.6, reason: 'remove gap' }],
    };
    assert.throws(() => renderCuts(source, edl, join(root, 'rejected.mp4')), /cannot be written as \.mp4/);

    const hard = join(root, 'hard.wav');
    const faded = join(root, 'faded.wav');
    const packed = join(root, 'packed.m4a');
    const hardResult = renderCuts(source, edl, hard);
    renderCuts(source, edl, faded, { joinFadeMs: 12 });
    const packedResult = renderCuts(source, edl, packed, { joinFadeMs: 12 });
    assert.ok(Math.abs(hardResult.durationSeconds - 0.8) < 0.02);
    assert.equal(probeMedia(packed, { requireVideo: false }).hasAudio, true);
    assert.equal(probeMedia(packed, { requireVideo: false }).videoStreams.length, 0);
    assert.ok(
      Math.abs(probeMedia(packed, { requireVideo: false }).durationSeconds - packedResult.durationSeconds) < 0.15,
    );

    const joinIndex = Math.round(0.4 * 48000);
    assert.ok(peakAround(hard, joinIndex) > 0.5);
    assert.ok(peakAround(faded, joinIndex) < 0.08);
    const whole = join(root, 'whole.wav');
    renderCuts(source, { schemaVersion: 1, sourceDurationSeconds: durationSeconds, cuts: [] }, whole, {
      joinFadeMs: 12,
    });
    assert.ok(peakAround(whole, 0) < 0.08);

    const mp3 = join(root, 'tone.mp3');
    const encoded = ffmpeg(['-i', source, '-c:a', 'libmp3lame', '-q:a', '4', mp3]);
    assert.equal(encoded.status, 0, encoded.stderr);
    const mp3Duration = probeMedia(mp3, { requireVideo: false }).durationSeconds;
    const fromMp3 = join(root, 'from-mp3.wav');
    renderCuts(
      mp3,
      {
        schemaVersion: 1,
        sourceDurationSeconds: mp3Duration,
        cuts: [{ sourceStart: 0.2, sourceEnd: 0.35, reason: 'remove gap' }],
      },
      fromMp3,
    );
    assert.equal(probeMedia(fromMp3, { requireVideo: false }).hasAudio, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fades audio inside a video cut and can write that audio alone', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-video-fade-'));
  try {
    const source = join(root, 'source.mp4');
    const generated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=25:duration=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=1',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-c:a',
      'aac',
      '-shortest',
      source,
    ]);
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);
    const durationSeconds = probeMedia(source).durationSeconds;
    const edl = {
      schemaVersion: 1,
      sourceDurationSeconds: durationSeconds,
      cuts: [{ sourceStart: 0.4, sourceEnd: 0.6, reason: 'remove gap' }],
    };
    const video = join(root, 'cut.mp4');
    const audio = join(root, 'cut.wav');
    renderCuts(source, edl, video, { joinFadeMs: 12 });
    renderCuts(source, edl, audio, { joinFadeMs: 12 });
    const rendered = probeMedia(video);
    assert.equal(rendered.hasAudio, true);
    assert.equal(rendered.width, 160);
    const extracted = probeMedia(audio, { requireVideo: false });
    assert.equal(extracted.videoStreams.length, 0);
    assert.equal(extracted.hasAudio, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detects silence, retimes words, and applies the EDL to an audio-only source', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-voiceover-'));
  try {
    const source = join(root, 'voiceover.wav');
    const generated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=0.6',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=sample_rate=48000:channel_layout=mono:duration=0.8',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:sample_rate=48000:duration=0.6',
      '-filter_complex',
      '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
      '-map',
      '[out]',
      source,
    ]);
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const proposalPath = join(root, 'silence-proposal.json');
    const optionsPath = join(root, 'silence-options.json');
    writeFileSync(optionsPath, JSON.stringify({ minSilenceSeconds: 0.3, paddingSeconds: 0.1 }));
    const detected = cli(['detect-silence', source, proposalPath, optionsPath]);
    assert.equal(detected.status, 0, detected.stderr);
    const edl = JSON.parse(readFileSync(proposalPath, 'utf8'));
    assert.equal(edl.cuts.length, 1);
    const direct = detectAcousticSilence(source, { minSilenceSeconds: 0.3, paddingSeconds: 0.1 });
    assert.deepEqual(edl.cuts, direct.cuts);

    const transcriptPath = join(root, 'transcript.json');
    const retimedPath = join(root, 'retimed.json');
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        schemaVersion: 1,
        durationSeconds: edl.sourceDurationSeconds,
        words: [
          { text: 'hello', start: 0.05, end: 0.4 },
          { text: 'again', start: edl.sourceDurationSeconds - 0.4, end: edl.sourceDurationSeconds - 0.05 },
        ],
      }),
    );
    const retimed = retimeTranscript(JSON.parse(readFileSync(transcriptPath, 'utf8')), edl);
    assert.equal(retimed.words.length, 2);
    assert.ok(retimed.durationSeconds < edl.sourceDurationSeconds);
    assert.equal(retimed.words[0].start, 0.05);
    const cliRetimed = cli(['retime', transcriptPath, proposalPath, retimedPath]);
    assert.equal(cliRetimed.status, 0, cliRetimed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(retimedPath, 'utf8')), retimed);

    const cutOptions = join(root, 'cut-options.json');
    const output = join(root, 'voiceover.m4a');
    writeFileSync(cutOptions, JSON.stringify({ joinFadeMs: 12 }));
    const applied = cli(['apply-edl', source, proposalPath, output, cutOptions]);
    assert.equal(applied.status, 0, applied.stderr);
    const rendered = probeMedia(output, { requireVideo: false });
    assert.equal(rendered.videoStreams.length, 0);
    assert.equal(rendered.hasAudio, true);
    assert.ok(Math.abs(rendered.durationSeconds - retimed.durationSeconds) < 0.15);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function ffmpeg(args) {
  return spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function cli(args) {
  return spawnSync(process.execPath, ['src/cli.mjs', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function peakAround(path, center) {
  const { samples } = readWavSamples(path);
  const start = Math.max(0, center - 24);
  const end = Math.min(samples.length, center + 24);
  let peak = 0;
  for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
  return peak;
}

function readWavSamples(path) {
  const buffer = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === 'data') {
      const samples = [];
      for (let index = dataStart; index + 2 <= dataStart + size && index + 2 <= buffer.length; index += 2) {
        samples.push(buffer.readInt16LE(index) / 32768);
      }
      return { samples };
    }
    offset = dataStart + size + (size % 2);
  }
  throw new Error(`WAV data chunk not found: ${path}`);
}
