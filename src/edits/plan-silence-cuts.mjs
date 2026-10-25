import { validateTranscript } from '../transcript/validate.mjs';
import { validateEdl } from './retime-transcript.mjs';

export function planSilenceCuts(transcript, options = {}) {
  validateTranscript(transcript);
  const { minGap = 0.55, headPad = 0.22, tailPad = 0.34 } = options;
  for (const [name, value] of Object.entries({ minGap, headPad, tailPad })) {
    if (!Number.isFinite(value) || value < 0 || (name === 'minGap' && value === 0)) {
      throw new TypeError(`${name} must be ${name === 'minGap' ? 'positive' : 'non-negative'}.`);
    }
  }
  if (transcript.words.length === 0) throw new TypeError('Cannot plan silence cuts without timed words.');

  const words = transcript.words;
  const cuts = [];
  const headEnd = words[0].start - headPad;
  if (headEnd > 0) cuts.push({ sourceStart: 0, sourceEnd: headEnd, reason: 'head silence' });

  for (let index = 1; index < words.length; index++) {
    const previous = words[index - 1];
    const next = words[index];
    const gap = next.start - previous.end;
    if (gap < minGap) continue;

    const keep = gap >= 2 ? 0.24 : /[.!?]$/.test(previous.text) ? 0.2 : 0.14;
    const sourceStart = previous.end + keep * 0.55;
    const sourceEnd = next.start - keep * 0.45;
    if (sourceEnd > sourceStart) {
      cuts.push({
        sourceStart: round(sourceStart),
        sourceEnd: round(sourceEnd),
        reason: `pause ${gap.toFixed(2)}s shortened to ${keep.toFixed(2)}s`,
      });
    }
  }

  const tailStart = words.at(-1).end + tailPad;
  if (tailStart < transcript.durationSeconds) {
    cuts.push({ sourceStart: tailStart, sourceEnd: transcript.durationSeconds, reason: 'tail silence' });
  }

  const edl = { schemaVersion: 1, sourceDurationSeconds: transcript.durationSeconds, cuts };
  validateEdl(edl, transcript.durationSeconds);
  return edl;
}

function round(value) {
  return Number(value.toFixed(3));
}
