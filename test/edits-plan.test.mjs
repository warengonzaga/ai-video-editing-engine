import test from 'node:test';
import assert from 'node:assert/strict';
import { findMistakeCandidates } from '../src/edits/find-mistake-candidates.mjs';
import { planSilenceCuts } from '../src/edits/plan-silence-cuts.mjs';

const transcript = {
  schemaVersion: 1,
  durationSeconds: 8,
  words: [
    { text: 'Well,', start: 1, end: 1.3 },
    { text: 'well', start: 1.55, end: 1.85 },
    { text: 'hello.', start: 3, end: 3.4 },
  ],
};

test('plans silence cuts around words while keeping natural breath gaps', () => {
  const edl = planSilenceCuts(transcript);
  assert.equal(edl.schemaVersion, 1);
  assert.equal(edl.cuts[0].reason, 'head silence');
  assert.equal(edl.cuts.at(-1).reason, 'tail silence');
  assert.ok(edl.cuts.every((cut, index) => index === 0 || cut.sourceStart >= edl.cuts[index - 1].sourceEnd));
});

test('proposes a repeated word without applying the cut', () => {
  const candidates = findMistakeCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].confidence, 'review');
  assert.equal(candidates[0].removes, 'Well,');
  assert.equal(candidates[0].cut.sourceEnd, transcript.words[1].start);
});

test('requires word-level timing for repeated-word candidates', () => {
  assert.throws(
    () => findMistakeCandidates({ ...transcript, granularity: 'cue' }),
    /word-level transcript/
  );
});

test('rejects silence-cut parameters outside their valid range', () => {
  assert.throws(() => planSilenceCuts(transcript, { minGap: 0 }), /minGap must be positive/);
});
