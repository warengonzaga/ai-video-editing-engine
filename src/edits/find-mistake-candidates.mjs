import { validateTranscript } from '../transcript/validate.mjs';

export function findMistakeCandidates(transcript, { maxRepeatGap = 0.5 } = {}) {
  validateTranscript(transcript);
  if (transcript.granularity === 'cue') {
    throw new TypeError('Mistake candidates require a word-level transcript.');
  }
  if (!Number.isFinite(maxRepeatGap) || maxRepeatGap < 0) {
    throw new TypeError('maxRepeatGap must be a non-negative number.');
  }

  const candidates = [];
  for (let index = 1; index < transcript.words.length; index++) {
    const first = transcript.words[index - 1];
    const second = transcript.words[index];
    const firstToken = normalize(first.text);
    const secondToken = normalize(second.text);
    const gap = second.start - first.end;
    if (!firstToken || firstToken !== secondToken || gap < 0 || gap > maxRepeatGap) continue;

    candidates.push({
      id: `repeat-${String(candidates.length + 1).padStart(3, '0')}`,
      type: 'repeated-word',
      confidence: 'review',
      cut: {
        sourceStart: first.start,
        sourceEnd: second.start,
        reason: `possible repeated word: ${first.text}`,
      },
      removes: first.text,
      keeps: second.text,
      context: transcript.words
        .slice(Math.max(0, index - 4), Math.min(transcript.words.length, index + 4))
        .map((word) => word.text)
        .join(' '),
    });
  }
  return candidates;
}

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
