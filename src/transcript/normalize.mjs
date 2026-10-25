import { validateTranscript } from './validate.mjs';

export function normalizeTranscript(input, durationSeconds, granularity = 'word') {
  const sourceWords = Array.isArray(input) ? input : input?.words;
  if (!Array.isArray(sourceWords)) throw new TypeError('Transcript input must contain a words array.');
  const words = sourceWords
    .filter((word) => word?.type === undefined || word.type === 'word')
    .map((word) => ({
      text: String(word.text ?? word.word ?? '').trim(),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter((word) => word.text);
  const transcript = { schemaVersion: 1, durationSeconds, granularity, words };
  validateTranscript(transcript);
  return transcript;
}
