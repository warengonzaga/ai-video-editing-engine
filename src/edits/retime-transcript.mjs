import { validateTranscript } from '../transcript/validate.mjs';

export function retimeTranscript(transcript, edl) {
  validateTranscript(transcript);
  validateEdl(edl, transcript.durationSeconds);

  const words = transcript.words.flatMap((word) => {
    const containingCut = edl.cuts.find(
      (cut) => cut.sourceStart <= word.start && cut.sourceEnd >= word.end
    );
    if (containingCut) return [];

    const partialCut = edl.cuts.find(
      (cut) => cut.sourceStart < word.end && cut.sourceEnd > word.start
    );
    if (partialCut) {
      throw new TypeError(`EDL cut ${partialCut.sourceStart}-${partialCut.sourceEnd} splits transcript word "${word.text}".`);
    }

    const removedBefore = edl.cuts
      .filter((cut) => cut.sourceEnd <= word.start)
      .reduce((total, cut) => total + cut.sourceEnd - cut.sourceStart, 0);
    return [{ ...word, start: word.start - removedBefore, end: word.end - removedBefore }];
  });

  const removedDuration = edl.cuts.reduce(
    (total, cut) => total + cut.sourceEnd - cut.sourceStart,
    0
  );
  if (removedDuration >= transcript.durationSeconds) {
    throw new TypeError('EDL must leave a positive output duration.');
  }
  return {
    schemaVersion: 1,
    durationSeconds: transcript.durationSeconds - removedDuration,
    ...(transcript.granularity ? { granularity: transcript.granularity } : {}),
    words,
  };
}

export function validateEdl(edl, sourceDurationSeconds) {
  if (!edl || typeof edl !== 'object' || Array.isArray(edl)) {
    throw new TypeError('EDL must be a JSON object.');
  }
  if (edl.schemaVersion !== 1) {
    throw new TypeError('EDL schemaVersion must be 1.');
  }
  if (!Number.isFinite(edl.sourceDurationSeconds) || edl.sourceDurationSeconds <= 0) {
    throw new TypeError('EDL sourceDurationSeconds must be a positive number.');
  }
  if (Math.abs(edl.sourceDurationSeconds - sourceDurationSeconds) > 1e-6) {
    throw new TypeError('EDL sourceDurationSeconds must match the transcript duration.');
  }
  if (!Array.isArray(edl.cuts)) {
    throw new TypeError('EDL cuts must be an array.');
  }

  let previousEnd = 0;
  for (const [index, cut] of edl.cuts.entries()) {
    const label = `EDL cut ${index + 1}`;
    if (!cut || typeof cut !== 'object' || Array.isArray(cut)) {
      throw new TypeError(`${label} must be an object.`);
    }
    if (!Number.isFinite(cut.sourceStart) || !Number.isFinite(cut.sourceEnd) || cut.sourceStart < 0 || cut.sourceEnd <= cut.sourceStart) {
      throw new TypeError(`${label} must have finite times with 0 <= sourceStart < sourceEnd.`);
    }
    if (cut.sourceEnd > sourceDurationSeconds) {
      throw new TypeError(`${label} ends after the source duration.`);
    }
    if (cut.sourceStart < previousEnd) {
      throw new TypeError(`${label} overlaps or is out of order.`);
    }
    if (typeof cut.reason !== 'string' || !cut.reason.trim()) {
      throw new TypeError(`${label} reason must be a non-empty string.`);
    }
    previousEnd = cut.sourceEnd;
  }
  const removedDuration = edl.cuts.reduce(
    (total, cut) => total + cut.sourceEnd - cut.sourceStart,
    0
  );
  if (removedDuration >= sourceDurationSeconds) {
    throw new TypeError('EDL must leave a positive output duration.');
  }
  return edl;
}
