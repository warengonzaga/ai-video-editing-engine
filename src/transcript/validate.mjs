export function validateTranscript(transcript) {
  if (!transcript || typeof transcript !== 'object' || Array.isArray(transcript)) {
    throw new TypeError('Transcript must be a JSON object.');
  }
  if (transcript.schemaVersion !== 1) {
    throw new TypeError('Transcript schemaVersion must be 1.');
  }
  if (!Number.isFinite(transcript.durationSeconds) || transcript.durationSeconds <= 0) {
    throw new TypeError('Transcript durationSeconds must be a positive number.');
  }
  if (!Array.isArray(transcript.words)) {
    throw new TypeError('Transcript words must be an array.');
  }
  if (transcript.granularity !== undefined && !['word', 'cue'].includes(transcript.granularity)) {
    throw new TypeError('Transcript granularity must be word or cue.');
  }

  let previousStart = -Infinity;
  for (const [index, word] of transcript.words.entries()) {
    const label = `Transcript word ${index + 1}`;
    if (!word || typeof word !== 'object' || Array.isArray(word)) {
      throw new TypeError(`${label} must be an object.`);
    }
    if (typeof word.text !== 'string' || !word.text.trim()) {
      throw new TypeError(`${label} text must be a non-empty string.`);
    }
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start) {
      throw new TypeError(`${label} must have finite times with 0 <= start < end.`);
    }
    if (word.end > transcript.durationSeconds) {
      throw new TypeError(`${label} ends after the source duration.`);
    }
    if (word.start < previousStart) {
      throw new TypeError(`${label} starts before the previous word.`);
    }
    previousStart = word.start;
  }
  return transcript;
}
