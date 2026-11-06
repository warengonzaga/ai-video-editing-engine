import { probeMedia } from './probe.mjs';

/** Run a pluggable media analyzer and normalize its time-coded findings. */
export async function analyzeMediaWithProvider(mediaPath, provider, options = {}) {
  const media = probeMedia(mediaPath, { requireVideo: false });
  if (!provider || typeof provider !== 'object'
      || !/^[a-z][a-z0-9-]*$/.test(provider.id ?? '')
      || typeof provider.analyze !== 'function') {
    throw new TypeError('Provider must define a kebab-case id and async analyze function.');
  }
  const findings = await provider.analyze({
    mediaPath: media.path,
    durationSeconds: media.durationSeconds,
    media: structuredClone(media),
    options: structuredClone(options.providerOptions ?? {}),
  });
  return {
    providerId: provider.id,
    analysis: normalizeMediaFindings(findings, media.durationSeconds),
  };
}

export function normalizeMediaFindings(input, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('Media analysis durationSeconds must be positive.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.findings)) {
    throw new TypeError('Media analysis result must contain a findings array.');
  }

  const findings = input.findings.map((finding, index) => {
    const label = `Media analysis finding ${index + 1}`;
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
        || typeof finding.type !== 'string' || !/^[a-z][a-z0-9-]*$/.test(finding.type)) {
      throw new TypeError(`${label} must define a kebab-case type.`);
    }
    const { startSeconds, endSeconds, confidence, description } = finding;
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds >= durationSeconds) {
      throw new TypeError(`${label} startSeconds must be inside the media duration.`);
    }
    if (endSeconds !== undefined
        && (!Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > durationSeconds)) {
      throw new TypeError(`${label} endSeconds must be after startSeconds and within the media duration.`);
    }
    if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new TypeError(`${label} confidence must be between 0 and 1.`);
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
      throw new TypeError(`${label} description must be a string up to 1000 characters.`);
    }
    return {
      id: `finding-${String(index + 1).padStart(3, '0')}`,
      type: finding.type,
      startSeconds,
      ...(endSeconds !== undefined ? { endSeconds } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  }).sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));

  return { schemaVersion: 1, durationSeconds, findings };
}
