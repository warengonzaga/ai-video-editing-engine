import assert from 'node:assert/strict';
import test from 'node:test';
import { retimeTranscript } from '../src/edits/retime-transcript.mjs';

const transcript = {
  schemaVersion: 1,
  durationSeconds: 10,
  words: [
    { text: 'Hello', start: 1, end: 1.5 },
    { text: 'there', start: 3, end: 3.5 },
    { text: 'friend', start: 8, end: 8.5 },
  ],
};

test('retimes retained words and drops a word covered by an approved cut', () => {
  const result = retimeTranscript(transcript, {
    schemaVersion: 1,
    sourceDurationSeconds: 10,
    cuts: [{ sourceStart: 2, sourceEnd: 4, reason: 'remove retake' }],
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    durationSeconds: 8,
    words: [
      { text: 'Hello', start: 1, end: 1.5 },
      { text: 'friend', start: 6, end: 6.5 },
    ],
  });
});

test('preserves overlapping provider word timings when retiming', () => {
  const overlapping = {
    schemaVersion: 1,
    durationSeconds: 10,
    granularity: 'word',
    words: [
      { text: 'could', start: 2, end: 2.8 },
      { text: 'you', start: 2.6, end: 3.1 },
      { text: 'help', start: 5, end: 5.4 },
    ],
  };
  const result = retimeTranscript(overlapping, {
    schemaVersion: 1,
    sourceDurationSeconds: 10,
    cuts: [{ sourceStart: 0.5, sourceEnd: 1, reason: 'remove lead-in' }],
  });

  assert.deepEqual(result.words, [
    { text: 'could', start: 1.5, end: 2.3 },
    { text: 'you', start: 2.1, end: 2.6 },
    { text: 'help', start: 4.5, end: 4.9 },
  ]);
  assert.ok(result.words[1].start < result.words[0].end);
});

test('rejects an EDL that splits a transcript word', () => {
  assert.throws(
    () =>
      retimeTranscript(transcript, {
        schemaVersion: 1,
        sourceDurationSeconds: 10,
        cuts: [{ sourceStart: 1.2, sourceEnd: 2, reason: 'partial word' }],
      }),
    /splits transcript word "Hello"/,
  );
});

test('rejects cuts that touch only part of a word at either boundary', () => {
  for (const cut of [
    { sourceStart: 1, sourceEnd: 1.2, reason: 'cut word opening' },
    { sourceStart: 1.3, sourceEnd: 1.5, reason: 'cut word ending' },
  ]) {
    assert.throws(
      () =>
        retimeTranscript(transcript, {
          schemaVersion: 1,
          sourceDurationSeconds: 10,
          cuts: [cut],
        }),
      /splits transcript word "Hello"/,
    );
  }
});

test('rejects cuts whose source duration does not match the transcript', () => {
  assert.throws(
    () =>
      retimeTranscript(transcript, {
        schemaVersion: 1,
        sourceDurationSeconds: 9,
        cuts: [],
      }),
    /must match the transcript duration/,
  );
});

test('rejects an EDL that removes the entire source', () => {
  assert.throws(
    () =>
      retimeTranscript(transcript, {
        schemaVersion: 1,
        sourceDurationSeconds: 10,
        cuts: [{ sourceStart: 0, sourceEnd: 10, reason: 'remove all content' }],
      }),
    /leave a positive output duration/,
  );
});

test('preserves transcript granularity after retiming', () => {
  const result = retimeTranscript(
    { ...transcript, granularity: 'word' },
    {
      schemaVersion: 1,
      sourceDurationSeconds: 10,
      cuts: [],
    },
  );
  assert.equal(result.granularity, 'word');
});
