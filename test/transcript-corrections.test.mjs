import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTranscriptCorrections } from '../src/transcript/corrections.mjs';

const transcript = {
  schemaVersion: 1,
  durationSeconds: 2,
  words: [
    { text: 'Helo', start: 0.2, end: 0.6 },
    { text: 'world.', start: 0.7, end: 1.2 },
  ],
};

test('applies indexed transcript text and timing corrections without mutating input', () => {
  const corrected = applyTranscriptCorrections(transcript, [
    { wordIndex: 0, text: 'Hello' },
    { wordIndex: 1, start: 0.65, end: 1.25 },
  ]);
  assert.deepEqual(corrected.words, [
    { text: 'Hello', start: 0.2, end: 0.6 },
    { text: 'world.', start: 0.65, end: 1.25 },
  ]);
  assert.equal(transcript.words[0].text, 'Helo');
});

test('rejects duplicate and out-of-range transcript corrections', () => {
  assert.throws(
    () =>
      applyTranscriptCorrections(transcript, [
        { wordIndex: 0, text: 'Hello' },
        { wordIndex: 0, text: 'Hi' },
      ]),
    /duplicate corrections/,
  );
  assert.throws(() => applyTranscriptCorrections(transcript, [{ wordIndex: 9, text: 'Hello' }]), /invalid wordIndex/);
  assert.throws(() => applyTranscriptCorrections(transcript, [{ wordIndex: 0, start: 0.8 }]), /start/);
});
