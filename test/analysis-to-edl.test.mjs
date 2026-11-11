import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaAnalysisToEdl } from '../src/edits/analysis-to-edl.mjs';
import { approveEdl, retimeTranscript } from '../src/edits/retime-transcript.mjs';
import { normalizeMediaFindings } from '../src/media/analysis-provider.mjs';
import { timelineFromEdl } from '../src/timeline/from-edl.mjs';

const transcript = {
  schemaVersion: 1,
  durationSeconds: 10,
  words: [
    { text: 'Start', start: 0.5, end: 1 },
    { text: 'End', start: 8, end: 8.5 },
  ],
};

test('turns provider cut suggestions into a review-gated EDL', () => {
  const analysis = normalizeMediaFindings(
    {
      findings: [
        {
          type: 'dead-air',
          startSeconds: 2,
          confidence: 0.9,
          suggestion: { type: 'remove-range', sourceStart: 2, sourceEnd: 4, reason: 'remove long silence' },
        },
        {
          type: 'false-start',
          startSeconds: 3.5,
          confidence: 0.8,
          suggestion: { type: 'remove-range', sourceStart: 3.5, sourceEnd: 5, reason: 'remove false start' },
        },
        {
          type: 'scene',
          startSeconds: 6,
          confidence: 0.2,
          suggestion: { type: 'remove-range', sourceStart: 6, sourceEnd: 7, reason: 'low-confidence proposal' },
        },
        {
          type: 'scene',
          startSeconds: 7,
          suggestion: { type: 'remove-range', sourceStart: 7, sourceEnd: 7.5, reason: 'unscored proposal' },
        },
        { type: 'scene-change', startSeconds: 7 },
      ],
    },
    10,
  );
  const draft = mediaAnalysisToEdl(analysis, { minConfidence: 0.5 });

  assert.equal(draft.reviewStatus, 'needs-review');
  assert.deepEqual(draft.cuts, [
    {
      sourceStart: 2,
      sourceEnd: 5,
      reason: 'finding-001: remove long silence; finding-002: remove false start',
    },
  ]);
  assert.throws(() => retimeTranscript(transcript, draft), /unapproved edit suggestions/);
  assert.throws(() => timelineFromEdl(draft, 'camera'), /unapproved edit suggestions/);

  const approved = approveEdl(draft);
  assert.equal(approved.reviewStatus, 'approved');
  assert.equal(retimeTranscript(transcript, approved).durationSeconds, 7);
  assert.throws(() => approveEdl(approved), /marked needs-review/);
});

test('rejects malformed provider cut suggestions and unapproved EDL timelines', () => {
  assert.throws(
    () =>
      normalizeMediaFindings(
        {
          findings: [
            {
              type: 'cut',
              startSeconds: 1,
              suggestion: { type: 'remove-range', sourceStart: 1, sourceEnd: 3, reason: 'cut', extra: true },
            },
          ],
        },
        5,
      ),
    /valid remove-range/,
  );
  assert.throws(
    () =>
      retimeTranscript(transcript, {
        schemaVersion: 1,
        sourceDurationSeconds: 10,
        reviewStatus: 'needs-review',
        cuts: [],
      }),
    /unapproved edit suggestions/,
  );
});
