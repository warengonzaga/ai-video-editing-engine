import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { animationStateAt, validateAnimationCues } from '../src/animation/cues.mjs';
import { mapRhubarbCuesToSpriteStates, normalizeRhubarbOutput, rhubarbLipSyncCues } from '../src/animation/rhubarb.mjs';

const existingDialogFile = fileURLToPath(new URL('./animation-cues.test.mjs', import.meta.url));

test('selects timed states with explicit gaps and exclusive ends', () => {
  const track = { schemaVersion: 1, durationSeconds: 2, cues: [
    { start: 0, end: 0.5, state: 'closed' },
    { start: 1, end: 2, state: 'open' },
  ] };
  assert.equal(animationStateAt(track, 0), 'closed');
  assert.equal(animationStateAt(track, 0.5, 'rest'), 'rest');
  assert.equal(animationStateAt(track, 1), 'open');
  assert.equal(animationStateAt(track, 2), null);
});

test('rejects overlapping, malformed and out-of-bounds cues', () => {
  const track = { schemaVersion: 1, durationSeconds: 2, cues: [
    { start: 0, end: 1, state: 'a' }, { start: 0.9, end: 2, state: 'b' },
  ] };
  assert.throws(() => validateAnimationCues(track));
  assert.throws(() => validateAnimationCues({ ...track, cues: [{ start: 0, end: 3, state: 'a' }] }));
  assert.throws(() => validateAnimationCues({ ...track, cues: [{ start: 0, end: 1, state: '' }] }));
  assert.throws(() => animationStateAt({ ...track, cues: [] }, -1));
});

test('normalizes Rhubarb shapes to lowercase cues and clamps rounded final timestamps', () => {
  const track = normalizeRhubarbOutput({ mouthCues: [
    { start: 0, end: 0.23, value: 'X' },
    { start: 0.23, end: 0.47, value: 'D' },
    { start: 0.47, end: 1.12, value: 'A' },
  ] }, 1.115);
  assert.deepEqual(track, { schemaVersion: 1, durationSeconds: 1.115, cues: [
    { start: 0, end: 0.23, state: 'x' },
    { start: 0.23, end: 0.47, state: 'd' },
    { start: 0.47, end: 1.115, state: 'a' },
  ] });
});

test('rejects unsupported Rhubarb shapes, overlapping cues, and malformed JSON', () => {
  assert.throws(() => normalizeRhubarbOutput('{invalid', 1), /invalid JSON/);
  assert.throws(() => normalizeRhubarbOutput({ mouthCues: [{ start: 0, end: 0.5, value: 'I' }] }, 1), /supported shapes/);
  assert.throws(() => normalizeRhubarbOutput({ mouthCues: [
    { start: 0, end: 0.6, value: 'A' }, { start: 0.5, end: 1, value: 'B' },
  ] }, 1));
  assert.throws(() => normalizeRhubarbOutput({ mouthCues: [{ start: 0, end: 1.1, value: 'A' }] }, 1), /within the audio duration/);
});

test('maps Rhubarb mouth shapes to a consumer sprite pack and allows overrides', () => {
  const track = normalizeRhubarbOutput({ mouthCues: [
    { start: 0, end: 0.2, value: 'X' },
    { start: 0.2, end: 0.4, value: 'A' },
    { start: 0.4, end: 0.6, value: 'F' },
  ] }, 0.6);
  assert.deepEqual(mapRhubarbCuesToSpriteStates(track).cues.map((cue) => cue.state), ['default', 'a', 'f']);
  assert.deepEqual(mapRhubarbCuesToSpriteStates(track, { x: 'neutral', a: 'shut', f: 'round' }).cues.map((cue) => cue.state), ['neutral', 'shut', 'round']);
  assert.throws(() => mapRhubarbCuesToSpriteStates(track, { x: 'rest' }), /No sprite state is mapped/);
  assert.throws(() => mapRhubarbCuesToSpriteStates(track, { x: '' }), /non-empty state names/);
  assert.throws(() => rhubarbLipSyncCues('unused.mp3', { spriteStateMap: { a: '' } }), /non-empty state names/);
});

test('rejects empty or conflicting inline dialog options', () => {
  assert.throws(() => rhubarbLipSyncCues('unused.mp3', { dialogText: '' }), /dialogText must be a non-empty string/);
  assert.throws(() => rhubarbLipSyncCues('unused.mp3', { dialogText: 'spoken words', dialogFile: existingDialogFile }), /Specify either dialogText or dialogFile/);
  assert.throws(() => rhubarbLipSyncCues('unused.mp3', { dialogText: 'spoken words', ffmpeg: '' }), /Rhubarb and FFmpeg executable names must be non-empty strings/);
});
