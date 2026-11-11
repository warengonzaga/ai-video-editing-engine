import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTranscript } from '../src/transcript/normalize.mjs';

test('normalizes provider word timing and filters non-word events', () => {
  const result = normalizeTranscript(
    {
      audio_duration_secs: 2,
      words: [
        { text: 'Hello', start: 0.1, end: 0.6, type: 'word' },
        { text: 'breath', start: 0.7, end: 0.8, type: 'audio_event' },
        { word: 'world.', start: 1, end: 1.5 },
      ],
    },
    2,
  );
  assert.deepEqual(result.words, [
    { text: 'Hello', start: 0.1, end: 0.6 },
    { text: 'world.', start: 1, end: 1.5 },
  ]);
});

test('rejects provider timestamps outside source duration', () => {
  assert.throws(() => normalizeTranscript([{ text: 'late', start: 1, end: 3 }], 2), /after the source duration/);
});
