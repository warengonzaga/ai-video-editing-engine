import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSpeedRampAudioAutomation,
  SPEED_RAMP_EASES,
  sliceSpeedRamp,
  speedRampDuration,
  speedRampPtsExpression,
  speedRampSourceAtTime,
  validateSpeedRamp,
} from '../src/timeline/speed-ramp.mjs';

const ramp = [
  { sourceOffset: 0, playbackRate: 1 },
  { sourceOffset: 2, playbackRate: 2 },
];

test('integrates and inverts a linear playback-rate curve', () => {
  const duration = 2 * Math.log(2);
  assert.ok(Math.abs(speedRampDuration(ramp) - duration) < 1e-12);
  assert.ok(Math.abs(speedRampSourceAtTime(ramp, 2 * Math.log(1.3)) - 0.6) < 1e-12);
  assert.deepEqual(sliceSpeedRamp(ramp, 0.5, 1.5), [
    { sourceOffset: 0, playbackRate: 1.25 },
    { sourceOffset: 1, playbackRate: 1.75 },
  ]);
});

test('compiles linear video timestamp mapping and bounded audio tempo commands', () => {
  const videoFilter = speedRampPtsExpression(ramp);
  assert.match(videoFilter, /^setpts=if\(lt\(T\\,/);
  assert.match(videoFilter, /log\(/);
  const audio = buildSpeedRampAudioAutomation(ramp, 'assets/.tempo.txt', 0.05);
  assert.match(audio.filters, /^asendcmd=f=assets\/\.tempo\.txt,rubberband@engine_speed_0=/);
  assert.match(audio.commandContents, /0\.05 rubberband@engine_speed_0 tempo 1\.0375;/);
  assert.equal(audio.commandContents.split('\n').length, 39);

  const wide = buildSpeedRampAudioAutomation(
    [
      { sourceOffset: 0, playbackRate: 0.1 },
      { sourceOffset: 1, playbackRate: 5 },
    ],
    'assets/.wide.txt',
    0.5,
  );
  assert.equal((wide.filters.match(/rubberband@engine_speed_/g) ?? []).length, 1);
});

test('supports eased speed curves and keeps video, audio, and sliced timing aligned', () => {
  const eased = [
    { sourceOffset: 0, playbackRate: 1, ease: 'easeInOutCubic' },
    { sourceOffset: 2, playbackRate: 3 },
  ];
  const linear = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 2, playbackRate: 3 },
  ];
  const duration = speedRampDuration(eased);
  assert.ok(Number.isFinite(duration));
  assert.notEqual(duration, speedRampDuration(linear));
  assert.equal(SPEED_RAMP_EASES.includes('easeInOutCubic'), true);
  assert.ok(Math.abs(speedRampSourceAtTime(eased, speedRampDuration(eased, 0, 1)) - 1) < 1e-9);

  const sliced = sliceSpeedRamp(eased, 0.25, 1.75);
  assert.ok(Math.abs(speedRampDuration(sliced) - speedRampDuration(eased, 0.25, 1.75)) < 1e-9);
  assert.match(speedRampPtsExpression(eased), /^setpts=if\(lt\(T\\,/);
  const audio = buildSpeedRampAudioAutomation(eased, 'assets/.eased-tempo.txt', 0.05);
  assert.match(audio.filters, /^asendcmd=f=assets\/\.eased-tempo\.txt,rubberband@engine_speed_0=/);
  assert.ok(audio.commandContents.split('\n').length > 39);
  const commandAtHalfSourceSecond = audio.commandContents
    .split('\n')
    .find((line) => Math.abs(Number(line.split(' ')[0]) - 0.5) < 1e-12);
  assert.ok(commandAtHalfSourceSecond);

  validateSpeedRamp({ id: 'eased-clip', sourceIn: 0, sourceOut: 2, durationSeconds: duration, speedRamp: eased });
  assert.throws(
    () =>
      validateSpeedRamp({
        id: 'bad-ease',
        sourceIn: 0,
        sourceOut: 2,
        durationSeconds: duration,
        speedRamp: [{ ...eased[0], ease: 'spring' }, eased[1]],
      }),
    /outgoing ease/,
  );
  assert.throws(
    () =>
      validateSpeedRamp({
        id: 'last-ease',
        sourceIn: 0,
        sourceOut: 2,
        durationSeconds: duration,
        speedRamp: [eased[0], { ...eased[1], ease: 'linear' }],
      }),
    /outgoing ease/,
  );
});
