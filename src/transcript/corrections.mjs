import { validateTranscript } from './validate.mjs';

export function applyTranscriptCorrections(transcript, corrections) {
  validateTranscript(transcript);
  if (!Array.isArray(corrections)) throw new TypeError('Transcript corrections must be an array.');
  const words = transcript.words.map((word) => ({ ...word }));
  const updated = new Set();
  for (const [index, correction] of corrections.entries()) {
    if (
      !correction ||
      !Number.isSafeInteger(correction.wordIndex) ||
      correction.wordIndex < 0 ||
      correction.wordIndex >= words.length
    )
      throw new TypeError(`Correction ${index + 1} has an invalid wordIndex.`);
    if (updated.has(correction.wordIndex))
      throw new TypeError(`Word ${correction.wordIndex} has duplicate corrections.`);
    updated.add(correction.wordIndex);
    const word = words[correction.wordIndex];
    if (correction.text !== undefined) {
      if (typeof correction.text !== 'string' || !correction.text.trim())
        throw new TypeError(`Correction ${index + 1} text must be a non-empty string.`);
      word.text = correction.text.trim();
    }
    if (correction.start !== undefined) word.start = correction.start;
    if (correction.end !== undefined) word.end = correction.end;
  }
  return validateTranscript({ ...transcript, words });
}
