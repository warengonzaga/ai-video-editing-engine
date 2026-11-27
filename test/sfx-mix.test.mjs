import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { probeMedia } from '../src/media/probe.mjs';
import { createSfxFilterGraph, mixSfx, parseSfxCues, parseSfxOptions } from '../src/media/sfx-mix.mjs';

const baseCue = {
  startSeconds: 1.25,
  gainDb: -6,
  fadeInSeconds: 0.01,
  fadeOutSeconds: 0.04,
  placedSeconds: 0.2,
};

test('parses cue times, gains, and fades', () => {
  const files = {
    'click.wav': { durationSeconds: 0.2 },
    'whoosh.wav': { durationSeconds: 0.5 },
  };
  const cues = parseSfxCues(
    [
      { file: 'click.wav', at: 1.25, gainDb: -6, fadeInMs: 10, fadeOutMs: 40 },
      { file: 'whoosh.wav', at: { frame: 12 } },
      { file: 'click.wav', at: { seconds: 0 } },
    ],
    { durationSeconds: 2, frameRate: 24, files },
  );
  assert.equal(cues[0].startSeconds, 1.25);
  assert.equal(cues[0].gainDb, -6);
  assert.equal(cues[0].fadeInSeconds, 0.01);
  assert.equal(cues[0].fadeOutSeconds, 0.04);
  assert.equal(cues[0].placedSeconds, 0.2);
  assert.equal(cues[1].startSeconds, 0.5);
  assert.equal(cues[1].gainDb, 0);
  assert.equal(cues[1].fadeInSeconds, 0);
  assert.equal(cues[2].startSeconds, 0);
  assert.equal(cues[2].placedSeconds, 0.2);
});

test('rejects invalid cues before a mix', () => {
  const files = { 'click.wav': { durationSeconds: 0.2 }, 'silent.wav': { durationSeconds: 0.2, hasAudio: false } };
  const context = { durationSeconds: 1, frameRate: 24, files };
  assert.throws(() => parseSfxCues({}, context), /must be an array/);
  assert.throws(() => parseSfxCues([], context), /at least one/);
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: 0, pan: 0 }], context), /unsupported field/);
  assert.throws(() => parseSfxCues([{ file: 'click.wav' }], context), /requires at/);
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: -1 }], context), /non-negative/);
  assert.throws(
    () => parseSfxCues([{ file: 'click.wav', at: { frame: 1, seconds: 0 } }], context),
    /only seconds or frame/,
  );
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: { frame: 1.5 } }], context), /non-negative integer/);
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: { frame: 3 } }]), /no frame rate/);
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: 0, gainDb: 80 }], context), /gainDb/);
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: 0, fadeInMs: -1 }], context), /fadeInMs/);
  assert.throws(() => parseSfxCues([{ file: 'missing.wav', at: 0 }], context), /file not found/);
  assert.throws(() => parseSfxCues([{ file: 'silent.wav', at: 0 }], context), /no audio stream/);
  assert.throws(
    () => parseSfxCues([{ file: 'click.wav', at: 1 }], context),
    /starts at 1s, which is outside the 1s source/,
  );
  const trimmed = parseSfxCues([{ file: 'click.wav', at: 0.95 }], context);
  assert.ok(Math.abs(trimmed[0].placedSeconds - 0.05) < 0.0001);
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: 0.9995 }], context), /outside the 1s source/);
  assert.throws(
    () => parseSfxCues([{ file: 'click.wav', at: 0, fadeInMs: 150, fadeOutMs: 150 }], context),
    /longer than the 0\.2s placed clip/,
  );
  assert.throws(() => parseSfxCues([{ file: 'click.wav', at: 0 }], null), /context must be an object/);
});

test('parses optional ducking and gain cap without changing defaults', () => {
  assert.deepEqual(parseSfxOptions({}), { duck: null, gainCapDb: null, fps: null });
  assert.equal(parseSfxOptions().duck, null);
  const ducked = parseSfxOptions({ duckUnderSpeech: true, gainCapDb: -1, fps: '30000/1001' });
  assert.deepEqual(ducked.duck, { thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 250 });
  assert.equal(ducked.gainCapDb, -1);
  assert.ok(Math.abs(ducked.fps - 30000 / 1001) < 0.0001);
  assert.equal(parseSfxOptions({ duckUnderSpeech: { ratio: 8 } }).duck.ratio, 8);
  assert.throws(() => parseSfxOptions({ duckUnderSpeech: { ratio: 40 } }), /ratio/);
  assert.throws(() => parseSfxOptions({ duckUnderSpeech: { knee: 2 } }), /unsupported field/);
  assert.throws(() => parseSfxOptions({ gainCapDb: 3 }), /gainCapDb/);
  assert.throws(() => parseSfxOptions({ gainCapDb: -30 }), /gainCapDb/);
  assert.throws(() => parseSfxOptions({ limiter: true }), /unsupported field/);
  assert.throws(() => parseSfxOptions([]), /must be an object/);
});

test('builds a filter graph that keeps the source level and can duck or cap effects', () => {
  const plain = createSfxFilterGraph({
    cues: [baseCue, { ...baseCue, startSeconds: 2, gainDb: 0, fadeInSeconds: 0, fadeOutSeconds: 0 }],
    hasSourceAudio: true,
    sampleRate: 48000,
    channels: 1,
    sourceDurationSeconds: 4,
  });
  assert.match(plain, /volume=-6dB/);
  assert.match(plain, /afade=t=in:d=0\.01/);
  assert.match(plain, /afade=t=out:st=0\.16:d=0\.04/);
  assert.match(plain, /adelay=1250:all=1/);
  assert.match(plain, /\[0:a\]\[sfx\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[a\]/);
  assert.doesNotMatch(plain, /sidechaincompress|alimiter/);

  const ducked = createSfxFilterGraph({
    cues: [baseCue],
    hasSourceAudio: true,
    sampleRate: 48000,
    channels: 2,
    sourceDurationSeconds: 4,
    duck: { thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 250 },
    gainCapDb: -1,
  });
  assert.match(ducked, /alimiter=limit=0\.891251:attack=5:release=50:level=0\[sfxlim\]/);
  assert.match(ducked, /\[0:a\]asplit=2\[base\]\[key\]/);
  assert.match(ducked, /\[sfxlim\]\[key\]sidechaincompress=/);
  assert.match(ducked, /\[base\]\[sfxduck\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[a\]/);
  assert.doesNotMatch(ducked, /\[key\]\[sfx/);

  const pictureOnly = createSfxFilterGraph({
    cues: [{ ...baseCue, startSeconds: 0, gainDb: 0, fadeInSeconds: 0, fadeOutSeconds: 0 }],
    hasSourceAudio: false,
    sampleRate: 48000,
    channels: 2,
    sourceDurationSeconds: 4,
  });
  assert.match(pictureOnly, /apad=whole_dur=4,atrim=end=4\[a\]/);
  assert.doesNotMatch(pictureOnly, /\[0:a\]|sidechaincompress/);
  assert.throws(
    () =>
      createSfxFilterGraph({
        cues: [baseCue],
        hasSourceAudio: false,
        sampleRate: 48000,
        channels: 2,
        sourceDurationSeconds: 4,
        duck: { thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 250 },
      }),
    /requires source audio/,
  );
});

test('rejects unsupported outputs and invalid options before rendering', () => {
  assert.throws(() => mixSfx('source.wav', [{ file: 'click.wav', at: 0 }], 'out.mp3'), /\.mp4, \.m4a, or \.wav/);
  assert.throws(() => mixSfx('source.wav', [], 'out.wav'), /at least one/);
  assert.throws(() => mixSfx('source.wav', [{ file: 'click.wav', at: 0, gainDb: 90 }], 'out.wav'), /gainDb/);
  assert.throws(
    () => mixSfx('source.wav', [{ file: 'click.wav', at: 0 }], 'out.wav', { makeup: 2 }),
    /unsupported field/,
  );
});

test('mixes generated tones at a cue time and can cap or duck them', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-sfx-'));
  try {
    const source = join(root, 'source.wav');
    const click = join(root, 'click.wav');
    const generated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=1',
      '-af',
      'volume=0.4',
      source,
    ]);
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);
    const clickResult = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=48000:duration=0.2',
      '-af',
      'volume=0.5',
      click,
    ]);
    assert.equal(clickResult.status, 0, clickResult.stderr);

    assert.throws(
      () => mixSfx(source, [{ file: join(root, 'missing.wav'), at: 0.2 }], join(root, 'missing-out.wav')),
      /file not found/,
    );
    assert.throws(() => mixSfx(source, [{ file: click, at: 2 }], join(root, 'late.wav')), /outside the/);
    assert.throws(() => mixSfx(source, [{ file: click, at: { frame: 12 } }], join(root, 'frame.wav')), /no frame rate/);

    const mixed = join(root, 'mixed.wav');
    const result = mixSfx(source, [{ file: click, at: 0.5, gainDb: -3, fadeInMs: 5, fadeOutMs: 10 }], mixed);
    assert.equal(result.duckUnderSpeech, false);
    assert.equal(result.gainCapDb, null);
    assert.equal(result.cues[0].startSeconds, 0.5);
    const rendered = probeMedia(mixed, { requireVideo: false });
    assert.equal(rendered.videoStreams.length, 0);
    assert.equal(rendered.audioChannels, 1);
    assert.ok(Math.abs(rendered.durationSeconds - 1) < 0.05);

    const rate = 48000;
    const before = [Math.round(0.1 * rate), Math.round(0.4 * rate)];
    const during = [Math.round(0.55 * rate), Math.round(0.65 * rate)];
    const after = [Math.round(0.8 * rate), Math.round(0.95 * rate)];
    const sourceBefore = rms(source, before[0], before[1]);
    assert.ok(Math.abs(rms(mixed, before[0], before[1]) - sourceBefore) / sourceBefore < 0.05);
    assert.ok(Math.abs(rms(mixed, after[0], after[1]) - rms(source, after[0], after[1])) / sourceBefore < 0.05);
    assert.ok(rms(mixed, during[0], during[1]) > sourceBefore * 1.2);

    const loud = join(root, 'loud.wav');
    const loudGenerated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=48000:duration=0.4',
      '-af',
      'volume=0.8',
      loud,
    ]);
    assert.equal(loudGenerated.status, 0, loudGenerated.stderr);
    const silence = join(root, 'silence.wav');
    const silenceGenerated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'anullsrc=sample_rate=48000:channel_layout=mono:duration=0.4',
      silence,
    ]);
    assert.equal(silenceGenerated.status, 0, silenceGenerated.stderr);
    const capped = join(root, 'capped.wav');
    mixSfx(silence, [{ file: loud, at: 0, gainDb: 12 }], capped, { gainCapDb: -6 });
    const cappedPeak = peak(capped, Math.round(0.12 * rate), Math.round(0.3 * rate));
    assert.ok(cappedPeak <= 0.6, `capped peak ${cappedPeak}`);
    assert.ok(cappedPeak >= 0.2, `capped peak ${cappedPeak}`);

    const bed = join(root, 'bed.wav');
    const effect = join(root, 'effect.wav');
    assert.equal(
      ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=1', '-af', 'volume=0.6', bed]).status,
      0,
    );
    assert.equal(
      ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1760:sample_rate=48000:duration=1', '-af', 'volume=0.6', effect])
        .status,
      0,
    );
    const openMix = join(root, 'open.wav');
    const duckedMix = join(root, 'ducked.wav');
    mixSfx(bed, [{ file: effect, at: 0 }], openMix);
    mixSfx(bed, [{ file: effect, at: 0 }], duckedMix, {
      duckUnderSpeech: { thresholdDb: -40, ratio: 20, attackMs: 1, releaseMs: 40 },
    });
    const middle = [Math.round(0.35 * rate), Math.round(0.7 * rate)];
    assert.ok(rms(duckedMix, middle[0], middle[1]) < rms(openMix, middle[0], middle[1]) * 0.85);

    const video = join(root, 'picture.mp4');
    const videoGenerated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'color=c=black:size=160x90:rate=24:duration=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=1',
      '-af',
      'volume=0.4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      video,
    ]);
    assert.equal(videoGenerated.status, 0, videoGenerated.stderr);
    const packed = join(root, 'packed.m4a');
    mixSfx(source, [{ file: click, at: 0.5 }], packed);
    const packedProbe = probeMedia(packed, { requireVideo: false });
    assert.equal(packedProbe.videoStreams.length, 0);
    assert.equal(packedProbe.hasAudio, true);

    const silentPicture = join(root, 'silent.mp4');
    const silentGenerated = ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'color=c=black:size=160x90:rate=24:duration=1',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      silentPicture,
    ]);
    assert.equal(silentGenerated.status, 0, silentGenerated.stderr);
    const silentOut = join(root, 'silent-sfx.mp4');
    mixSfx(silentPicture, [{ file: click, at: 0.25 }], silentOut);
    const silentProbe = probeMedia(silentOut);
    assert.equal(silentProbe.width, 160);
    assert.equal(silentProbe.hasAudio, true);
    assert.throws(
      () =>
        mixSfx(silentPicture, [{ file: click, at: 0.25 }], join(root, 'silent-ducked.mp4'), { duckUnderSpeech: true }),
      /requires an audio stream/,
    );

    const videoOut = join(root, 'picture-sfx.mp4');
    assert.throws(
      () => mixSfx(video, [{ file: click, at: { frame: 12 } }], join(root, 'wrong-rate.mp4'), { fps: 30 }),
      /does not match the source frame rate/,
    );
    const videoResult = mixSfx(video, [{ file: click, at: { frame: 12 }, gainDb: -6 }], videoOut);
    assert.ok(Math.abs(videoResult.cues[0].startSeconds - 0.5) < 0.0001);
    const picture = probeMedia(videoOut);
    assert.equal(picture.width, 160);
    assert.equal(picture.height, 90);
    assert.equal(picture.hasAudio, true);

    const cuesPath = join(root, 'cues.json');
    const cliOut = join(root, 'cli.wav');
    writeFileSync(cuesPath, JSON.stringify([{ file: 'click.wav', at: 0.5, gainDb: -6 }]));
    const cliResult = cli(['sfx', source, cuesPath, cliOut]);
    assert.equal(cliResult.status, 0, cliResult.stderr);
    const report = JSON.parse(cliResult.stdout);
    assert.equal(report.cues.length, 1);
    assert.equal(report.duckUnderSpeech, false);
    assert.ok(rms(cliOut, during[0], during[1]) > sourceBefore);
    const rejected = cli(['sfx', source, cuesPath, cliOut]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Output already exists/);
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

function rms(path, start, end) {
  const { samples } = readWavSamples(path);
  let sum = 0;
  let count = 0;
  for (let index = start; index < end && index < samples.length; index += 1) {
    sum += samples[index] ** 2;
    count += 1;
  }
  return Math.sqrt(sum / count);
}

function peak(path, start, end) {
  const { samples } = readWavSamples(path);
  let level = 0;
  for (let index = start; index < end && index < samples.length; index += 1) {
    level = Math.max(level, Math.abs(samples[index]));
  }
  return level;
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
